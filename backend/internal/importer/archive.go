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
)

const (
	// MaxUploadBytes bounds the compressed request body accepted by the import endpoint.
	MaxUploadBytes int64 = 100 << 20 // 100 MB
	// MaxEntries bounds work spent inspecting a ZIP central directory.
	MaxEntries = 2000
	// MaxTotalBytes bounds all decompressed archive entries combined.
	MaxTotalBytes int64 = 200 << 20 // 200 MB
)

var (
	ErrPasswordRequired = errors.New("this export is password-protected; enter its password")
	ErrDecrypt           = errors.New("could not decrypt export; check the password or archive")
	ErrNoNotes           = errors.New("archive contains no note entries")
)

// Limits controls ZIP resource limits. Production callers should use DefaultLimits.
type Limits struct {
	MaxEntries   int
	MaxTotalBytes int64
}

// DefaultLimits returns the documented production archive limits.
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

// Archive is a fully validated, decompressed Crapnote export.
type Archive struct {
	Notes  []Note
	Images map[string]Image
}

// Parse validates and reads an archive produced by export.Build.
func Parse(data []byte, password string, limits Limits) (*Archive, error) {
	if limits.MaxEntries <= 0 || limits.MaxTotalBytes <= 0 {
		return nil, errors.New("invalid import limits")
	}

	zr, err := yzip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("invalid or corrupt ZIP archive: %w", err)
	}
	if len(zr.File) > limits.MaxEntries {
		return nil, fmt.Errorf("archive has too many entries (maximum %d)", limits.MaxEntries)
	}

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
		if file.IsEncrypted() && password == "" {
			return nil, ErrPasswordRequired
		}
		declared += file.UncompressedSize64
		if declared > uint64(limits.MaxTotalBytes) {
			return nil, fmt.Errorf("archive expands beyond the %d MB limit", limits.MaxTotalBytes>>20)
		}
	}

	result := &Archive{Images: make(map[string]Image)}
	var actual int64
	for _, file := range zr.File {
		if file.IsEncrypted() {
			file.SetPassword(password)
		}
		r, err := file.Open()
		if err != nil {
			if file.IsEncrypted() {
				return nil, ErrDecrypt
			}
			return nil, fmt.Errorf("open archive entry %q: %w", file.Name, err)
		}
		entry, readErr := io.ReadAll(io.LimitReader(r, limits.MaxTotalBytes-actual+1))
		closeErr := r.Close()
		if readErr != nil || closeErr != nil {
			if file.IsEncrypted() {
				return nil, ErrDecrypt
			}
			if readErr != nil {
				return nil, fmt.Errorf("read archive entry %q: %w", file.Name, readErr)
			}
			return nil, fmt.Errorf("close archive entry %q: %w", file.Name, closeErr)
		}
		actual += int64(len(entry))
		if actual > limits.MaxTotalBytes {
			return nil, fmt.Errorf("archive expands beyond the %d MB limit", limits.MaxTotalBytes>>20)
		}

		switch {
		case strings.HasSuffix(file.Name, ".md") && !strings.Contains(file.Name, "/"):
			note, err := parseNote(file.Name, entry)
			if err != nil {
				return nil, err
			}
			result.Notes = append(result.Notes, note)
		case strings.HasPrefix(file.Name, "images/"):
			result.Images[file.Name] = Image{Path: file.Name, Data: entry}
		default:
			return nil, fmt.Errorf("unsupported archive entry %q", file.Name)
		}
	}
	if len(result.Notes) == 0 {
		return nil, ErrNoNotes
	}
	return result, nil
}

func validateEntry(name string, regular bool) error {
	if name == "" || !utf8.ValidString(name) || strings.Contains(name, "\\") || path.IsAbs(name) || path.Clean(name) != name || strings.HasPrefix(name, "../") || !regular {
		return fmt.Errorf("invalid archive entry %q", name)
	}
	if strings.Contains(name, "/") && (path.Dir(name) != "images" || path.Base(name) == ".") {
		return fmt.Errorf("unsupported archive entry %q", name)
	}
	return nil
}

func parseNote(name string, content []byte) (Note, error) {
	if !utf8.Valid(content) {
		return Note{}, fmt.Errorf("note entry %q is not valid UTF-8", name)
	}
	text := string(content)
	if !strings.HasPrefix(text, "# ") {
		return Note{}, fmt.Errorf("note entry %q is missing the Crapnote title heading", name)
	}
	separator := strings.Index(text, "\n\n")
	if separator < 2 || strings.Contains(text[2:separator], "\n") {
		return Note{}, fmt.Errorf("note entry %q has an invalid Crapnote title heading", name)
	}
	body := text[separator+2:]
	if !strings.HasSuffix(body, "\n") {
		return Note{}, fmt.Errorf("note entry %q is missing the Crapnote body terminator", name)
	}
	return Note{Title: text[2:separator], Body: strings.TrimSuffix(body, "\n")}, nil
}
