// Package export builds ZIP archives of a user's notes.
package export

import (
	"bytes"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode"

	yzip "github.com/yeka/zip"

	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/notes"
)

var (
	// unsafeChars covers characters that are illegal in filenames on common OSes.
	unsafeChars = regexp.MustCompile(`[/\\:*?"<>|]+`)
	// collapseSpaces replaces runs of whitespace/hyphens with a single hyphen.
	collapseSpaces = regexp.MustCompile(`[\s\-]+`)
	// imageAPIPath matches /api/images/<id> inside src="…" attributes.
	imageAPIPath = regexp.MustCompile(`/api/images/([a-f0-9\-]+)`)
)

// sanitiseFilename turns an arbitrary title into a safe .md filename.
// e.g. "Hello/World & More!" → "hello-world-more.md"
func sanitiseFilename(title string) string {
	s := strings.ToLower(title)
	// Remove unsafe FS characters.
	s = unsafeChars.ReplaceAllString(s, "-")
	// Drop non-printable / non-ASCII-safe characters.
	s = strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' || r == '.' {
			return r
		}
		return '-'
	}, s)
	// Collapse repeated separators and trim.
	s = collapseSpaces.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "note"
	}
	// Truncate to avoid excessively long names.
	if len(s) > 80 {
		s = s[:80]
	}
	return s + ".md"
}

// mimeToExt returns a file extension (without dot) for common image MIME types.
func mimeToExt(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/png":
		return "png"
	case "image/jpeg", "image/jpg":
		return "jpg"
	case "image/gif":
		return "gif"
	case "image/webp":
		return "webp"
	case "image/svg+xml":
		return "svg"
	case "image/avif":
		return "avif"
	default:
		// Fall back to the subtype part, e.g. "image/tiff" → "tiff".
		if idx := strings.Index(mimeType, "/"); idx >= 0 {
			return mimeType[idx+1:]
		}
		return "bin"
	}
}

// extractImageIDs returns the unique image IDs referenced in a note body.
func extractImageIDs(body string) []string {
	matches := imageAPIPath.FindAllStringSubmatch(body, -1)
	seen := make(map[string]struct{})
	var ids []string
	for _, m := range matches {
		id := m[1]
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	return ids
}

// rewriteImageSrcs replaces /api/images/<id> with images/<id>.<ext> in body.
func rewriteImageSrcs(body string, imgFiles map[string]string) string {
	return imageAPIPath.ReplaceAllStringFunc(body, func(match string) string {
		// match is the full "/api/images/<id>"
		sub := imageAPIPath.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		id := sub[1]
		if filename, ok := imgFiles[id]; ok {
			return "images/" + filename
		}
		return match
	})
}

// Build creates a ZIP archive of all non-trashed notes for userID.
// imageData maps image ID → image bytes+mime; if nil no images are bundled.
// If password is non-empty each entry is AES-256 encrypted.
func Build(w io.Writer, noteList []*notes.Note, imageData map[string]images.Data, password string) error {
	zw := yzip.NewWriter(w)

	// Collect all image IDs referenced across all notes, build id→filename map.
	imgFiles := make(map[string]string) // id → "images/<id>.<ext>" basename
	for _, n := range noteList {
		for _, id := range extractImageIDs(n.Body) {
			if _, ok := imgFiles[id]; ok {
				continue
			}
			if d, found := imageData[id]; found {
				imgFiles[id] = id + "." + mimeToExt(d.MimeType)
			}
		}
	}

	// Write image files first (images/ prefix inside the ZIP).
	for id, filename := range imgFiles {
		d := imageData[id]
		zipName := "images/" + filename

		var fw io.Writer
		var err error
		if password != "" {
			fw, err = zw.Encrypt(zipName, password, yzip.StandardEncryption)
		} else {
			fw, err = zw.Create(zipName)
		}
		if err != nil {
			return fmt.Errorf("zip entry %q: %w", zipName, err)
		}
		if _, err := io.Copy(fw, bytes.NewReader(d.Bytes)); err != nil {
			return fmt.Errorf("write entry %q: %w", zipName, err)
		}
	}

	// Write notes, rewriting image src paths to relative ones.
	seen := make(map[string]int)
	for _, n := range noteList {
		name := sanitiseFilename(n.Title)
		// Deduplicate: "note.md", "note-2.md", etc.
		if count := seen[name]; count > 0 {
			ext := ".md"
			base := strings.TrimSuffix(name, ext)
			name = fmt.Sprintf("%s-%d%s", base, count+1, ext)
		}
		seen[name]++

		body := rewriteImageSrcs(n.Body, imgFiles)
		content := fmt.Sprintf("# %s\n\n%s\n", n.Title, body)

		var fw io.Writer
		var err error
		if password != "" {
			fw, err = zw.Encrypt(name, password, yzip.StandardEncryption)
		} else {
			fw, err = zw.Create(name)
		}
		if err != nil {
			return fmt.Errorf("zip entry %q: %w", name, err)
		}
		if _, err := io.Copy(fw, bytes.NewBufferString(content)); err != nil {
			return fmt.Errorf("write entry %q: %w", name, err)
		}
	}

	// Close must be called to flush the zip central directory.
	if err := zw.Close(); err != nil {
		return fmt.Errorf("finalise zip: %w", err)
	}
	return nil
}
