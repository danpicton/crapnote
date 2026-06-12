// Package export_test exercises Build through its public interface.
package export_test

import (
	"bytes"
	"encoding/binary"
	"io"
	"testing"

	yzip "github.com/yeka/zip"

	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/notes"
)

// aesStrength parses a file header's extra field and returns the AES
// strength byte from the WinZip AES record (0x9901): 1 = AES-128,
// 2 = AES-192, 3 = AES-256. It returns 0 when no such record exists,
// i.e. the entry is unencrypted or uses legacy ZipCrypto.
func aesStrength(extra []byte) byte {
	const winZipAESExtraID = 0x9901
	for len(extra) >= 4 {
		id := binary.LittleEndian.Uint16(extra[0:2])
		size := int(binary.LittleEndian.Uint16(extra[2:4]))
		body := extra[4:]
		if len(body) < size {
			return 0
		}
		// Record layout: vendor version (2), vendor ID "AE" (2),
		// strength (1), original compression method (2).
		if id == winZipAESExtraID && size >= 5 {
			return body[4]
		}
		extra = body[size:]
	}
	return 0
}

// buildArchive runs export.Build over a couple of notes and returns the
// resulting ZIP bytes.
func buildArchive(t *testing.T, password string) []byte {
	t.Helper()
	noteList := []*notes.Note{
		{ID: 1, Title: "First Note", Body: "Hello world"},
		{ID: 2, Title: "Second Note", Body: "More content"},
	}
	var buf bytes.Buffer
	if err := export.Build(&buf, noteList, nil, password); err != nil {
		t.Fatalf("Build: %v", err)
	}
	return buf.Bytes()
}

func TestBuild_DuplicateTitlesGetDistinctFilenames(t *testing.T) {
	// All three titles sanitise to the same base name, so the archive must
	// deduplicate them — duplicate entry names silently corrupt the ZIP or
	// overwrite each other on extraction.
	noteList := []*notes.Note{
		{ID: 1, Title: "Note", Body: "first"},
		{ID: 2, Title: "Note", Body: "second"},
		{ID: 3, Title: "Note", Body: "third"},
	}
	var buf bytes.Buffer
	if err := export.Build(&buf, noteList, nil, ""); err != nil {
		t.Fatalf("Build: %v", err)
	}

	zr, err := yzip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	if len(zr.File) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(zr.File))
	}
	seen := make(map[string]bool)
	for _, f := range zr.File {
		if seen[f.Name] {
			t.Errorf("duplicate entry name %q in archive", f.Name)
		}
		seen[f.Name] = true
	}
	for _, want := range []string{"note.md", "note-2.md", "note-3.md"} {
		if !seen[want] {
			t.Errorf("expected entry %q, archive has %v", want, keys(seen))
		}
	}
}

func keys(m map[string]bool) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestBuild_PasswordProtectedUsesAES256(t *testing.T) {
	data := buildArchive(t, "correct horse battery staple")

	zr, err := yzip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	if len(zr.File) == 0 {
		t.Fatal("archive contains no entries")
	}

	// AES entries carry a WinZip AES extra record in the file header;
	// legacy ZipCrypto entries have none.
	const aes256 = 3
	for _, f := range zr.File {
		if !f.IsEncrypted() {
			t.Errorf("entry %q is not encrypted", f.Name)
		}
		if got := aesStrength(f.Extra); got != aes256 {
			t.Errorf("entry %q has AES strength %d, want %d (AES-256)", f.Name, got, aes256)
		}
	}
}

func TestBuild_PasswordProtectedDecryptsWithCorrectPassword(t *testing.T) {
	const password = "correct horse battery staple"
	data := buildArchive(t, password)

	zr, err := yzip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}

	found := false
	for _, f := range zr.File {
		if f.Name != "first-note.md" {
			continue
		}
		found = true
		f.SetPassword(password)
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open entry %q: %v", f.Name, err)
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read entry %q: %v", f.Name, err)
		}
		want := "# First Note\n\nHello world\n"
		if string(content) != want {
			t.Errorf("entry content = %q, want %q", content, want)
		}
	}
	if !found {
		t.Fatal("archive does not contain first-note.md")
	}
}

func TestBuild_PasswordProtectedRejectsWrongPassword(t *testing.T) {
	data := buildArchive(t, "correct horse battery staple")

	zr, err := yzip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}

	// Select the entry by name, not index — entry ordering inside the
	// archive is not part of Build's contract.
	var f *yzip.File
	for _, candidate := range zr.File {
		if candidate.Name == "first-note.md" {
			f = candidate
			break
		}
	}
	if f == nil {
		t.Fatal("archive does not contain first-note.md")
	}
	f.SetPassword("wrong password")
	rc, err := f.Open()
	if err == nil {
		_, err = io.ReadAll(rc)
		rc.Close()
	}
	if err == nil {
		t.Fatal("expected decryption with wrong password to fail, but it succeeded")
	}
}
