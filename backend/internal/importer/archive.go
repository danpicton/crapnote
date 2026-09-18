// Package importer restores notes and images from Crapnote export archives.
package importer

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"unicode/utf8"

	yzip "github.com/yeka/zip"

	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/notes"
)

const (
	// MaxUploadBytes bounds the compressed archive accepted by the import endpoint.
	MaxUploadBytes int64 = 100 << 20
	// MaxEntries bounds work spent inspecting a ZIP central directory.
	MaxEntries = 2000
	// MaxTotalBytes bounds all decompressed archive entries combined.
	MaxTotalBytes int64 = 200 << 20
)

var (
	ErrPasswordRequired = errors.New("this export is password-protected; enter its password")
	ErrDecrypt          = errors.New("could not decrypt export; check the password or archive")
	ErrNoNotes          = errors.New("archive contains no note entries")
)

// Limits controls ZIP resource limits. Production callers should use DefaultLimits.
type Limits struct {
	MaxEntries    int
	MaxTotalBytes int64
}

func DefaultLimits() Limits {
	return Limits{MaxEntries: MaxEntries, MaxTotalBytes: MaxTotalBytes}
}

// Note is one note decoded from the exporter's heading wrapper.
type Note struct {
	Title string
	Body  string
}

// Image is one bundled image, keyed by its relative archive path.
type Image struct {
	Path string
	Data []byte
}

// Archive is the materialised form used by archive parsing tests/tools. The
// production import path instead reads and stores one bounded entry at a time.
type Archive struct {
	Notes  []Note
	Images map[string]Image
}

// Parse validates and reads an archive produced by export.Build.
func Parse(data []byte, password string, limits Limits) (*Archive, error) {
	archive, err := openArchive(bytes.NewReader(data), int64(len(data)), password, limits)
	if err != nil {
		return nil, err
	}
	result := &Archive{Images: make(map[string]Image)}
	for _, file := range archive.images {
		entry, err := readEntry(file)
		if err != nil {
			return nil, err
		}
		result.Images[file.Name] = Image{Path: file.Name, Data: entry}
	}
	assigned := make(map[string]bool)
	for _, file := range archive.notes {
		note, err := readNote(file, assigned)
		if err != nil {
			return nil, err
		}
		result.Notes = append(result.Notes, note)
	}
	return result, nil
}

// Only ZIP metadata is retained here, never decompressed contents.
type archiveReader struct {
	images     []*yzip.File
	notes      []*yzip.File
	imageBytes int64
}

func openArchive(source io.ReaderAt, size int64, password string, limits Limits) (*archiveReader, error) {
	if limits.MaxEntries <= 0 || limits.MaxTotalBytes <= 0 {
		return nil, errors.New("invalid import limits")
	}
	if size > MaxUploadBytes {
		return nil, errors.New("compressed archive exceeds the 100 MB limit")
	}
	// yeka/zip allocates central-directory entries before callers can inspect
	// their count. Bound and verify the directory BEFORE invoking it.
	if err := checkDirectory(source, size, limits.MaxEntries); err != nil {
		return nil, fmt.Errorf("invalid or corrupt ZIP archive: %w", err)
	}
	zr, err := yzip.NewReader(source, size)
	if err != nil {
		return nil, fmt.Errorf("invalid or corrupt ZIP archive: %w", err)
	}
	result := &archiveReader{}
	seen := make(map[string]bool, len(zr.File))
	var declared uint64
	for _, file := range zr.File {
		if err := validateEntry(file.Name, file.FileInfo().Mode().IsRegular()); err != nil {
			return nil, err
		}
		if seen[file.Name] {
			return nil, fmt.Errorf("archive contains duplicate entry %q", file.Name)
		}
		seen[file.Name] = true
		if file.IsEncrypted() {
			if password == "" {
				return nil, ErrPasswordRequired
			}
			file.SetPassword(password)
		}
		maxTotal := uint64(limits.MaxTotalBytes)
		if file.UncompressedSize64 > maxTotal-declared {
			return nil, fmt.Errorf("archive expands beyond the %d MB limit", limits.MaxTotalBytes>>20)
		}
		declared += file.UncompressedSize64
		var maxEntry uint64
		switch {
		case strings.HasPrefix(file.Name, "images/"):
			maxEntry = images.MaxImageSize
			result.images = append(result.images, file)
			result.imageBytes += int64(file.UncompressedSize64)
		case strings.HasSuffix(file.Name, ".md"):
			maxEntry = uint64(notes.MaxTitleLen + notes.MaxBodyLen + len("# \n\n\n"))
			result.notes = append(result.notes, file)
		default:
			return nil, fmt.Errorf("unsupported archive entry %q", file.Name)
		}
		// Buffered AES authentication also retains compressed entry bytes. Cap
		// those independently (with ample room for deflate/AES overhead), so a
		// forged size cannot make the library buffer the entire 100 MB upload.
		if file.UncompressedSize64 > maxEntry || file.CompressedSize64 > maxEntry+(64<<10) {
			return nil, fmt.Errorf("archive entry exceeds the note/image size limit: %q", file.Name)
		}
	}
	if len(result.notes) == 0 {
		return nil, ErrNoNotes
	}
	return result, nil
}

func readEntry(file *yzip.File) ([]byte, error) {
	r, err := file.Open()
	if err != nil {
		if file.IsEncrypted() {
			return nil, ErrDecrypt
		}
		return nil, fmt.Errorf("open archive entry %q: %w", file.Name, err)
	}
	// Allocate once, bounded by the checked declaration. Reading one extra
	// byte both detects dishonest sizes and forces EOF/checksum verification.
	entry := make([]byte, int(file.UncompressedSize64)+1)
	var n int
	var readErr error
	for n < len(entry) && readErr == nil {
		var count int
		count, readErr = r.Read(entry[n:])
		n += count
	}
	closeErr := r.Close()
	// Only a clean EOF is success. io.ReadFull would conflate a genuine
	// truncated-stream ErrUnexpectedEOF with its own short-read signal.
	if readErr != io.EOF || closeErr != nil {
		if file.IsEncrypted() {
			return nil, ErrDecrypt
		}
		return nil, fmt.Errorf("corrupt archive entry %q (size or checksum mismatch)", file.Name)
	}
	if uint64(n) != file.UncompressedSize64 {
		return nil, fmt.Errorf("corrupt archive entry %q (size mismatch)", file.Name)
	}
	return entry[:n], nil
}

func readNote(file *yzip.File, assigned map[string]bool) (Note, error) {
	entry, err := readEntry(file)
	if err != nil {
		return Note{}, err
	}
	return parseNote(file.Name, entry, assigned)
}

func validateEntry(name string, regular bool) error {
	// Legacy exporter names may split UTF-8 at the 80-byte truncation boundary.
	// Names are never used as disk paths, but must still be safe archive paths.
	if name == "" || strings.ContainsAny(name, "\\:\x00") || path.IsAbs(name) || path.Clean(name) != name || strings.HasPrefix(name, "../") || !regular {
		return fmt.Errorf("invalid archive entry %q", name)
	}
	if strings.Contains(name, "/") && (path.Dir(name) != "images" || path.Base(name) == ".") {
		return fmt.Errorf("unsupported archive entry %q", name)
	}
	return nil
}

func parseNote(name string, content []byte, assigned map[string]bool) (Note, error) {
	if !utf8.Valid(content) {
		return Note{}, fmt.Errorf("note entry %q is not valid UTF-8", name)
	}
	text := string(content)
	if !strings.HasPrefix(text, "# ") {
		return Note{}, fmt.Errorf("note entry %q is missing the Crapnote title heading", name)
	}
	if !strings.HasSuffix(text, "\n") {
		return Note{}, fmt.Errorf("note entry %q is missing the Crapnote body terminator", name)
	}
	// A title may itself contain blank lines. Check every possible separator
	// against the exporter's filename and collision rules, never guess the
	// first/last one. Overlapping separators matter for trailing title newlines.
	var result Note
	matches := 0
	for separator := 2; separator <= 2+notes.MaxTitleLen && separator+2 < len(text); separator++ {
		if text[separator:separator+2] != "\n\n" {
			continue
		}
		title := text[2:separator]
		candidate := export.NoteFilename(title)
		base := strings.TrimSuffix(candidate, ".md")
		for i := 2; assigned[candidate]; i++ {
			candidate = fmt.Sprintf("%s-%d.md", base, i)
		}
		if candidate == name {
			matches++
			result = Note{Title: title, Body: text[separator+2 : len(text)-1]}
		}
	}
	if matches > 1 {
		return Note{}, fmt.Errorf("note entry %q has an ambiguous title/body boundary in this legacy export; remove leading/trailing blank lines from the source title/body or shorten the title, then export again", name)
	}
	if matches == 0 {
		return Note{}, fmt.Errorf("note entry %q has an invalid Crapnote title heading or filename", name)
	}
	assigned[name] = true
	return result, nil
}
