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

	"github.com/danpicton/crapnote/internal/notes"
)

var (
	// unsafeChars covers characters that are illegal in filenames on common OSes.
	unsafeChars = regexp.MustCompile(`[/\\:*?"<>|]+`)
	// collapseSpaces replaces runs of whitespace/hyphens with a single hyphen.
	collapseSpaces = regexp.MustCompile(`[\s\-]+`)
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

// Build creates a ZIP archive of all non-trashed notes for userID.
// If password is non-empty each entry is AES-256 encrypted.
func Build(w io.Writer, noteList []*notes.Note, password string) error {
	zw := yzip.NewWriter(w)

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

		content := fmt.Sprintf("# %s\n\n%s\n", n.Title, n.Body)

		var fw io.Writer
		var err error
		if password != "" {
			fw, err = zw.Encrypt(name, password, yzip.AES256Encryption)
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
