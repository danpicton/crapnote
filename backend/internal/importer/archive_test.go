package importer_test

import (
	"bytes"
	"encoding/binary"
	"errors"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/importer"
	"github.com/danpicton/crapnote/internal/notes"
)

func TestParse_RoundTripsExportedNoteContent(t *testing.T) {
	original := []*notes.Note{
		{Title: "Duplicate — 日本語", Body: "First body\n\n# Original heading"},
		{Title: "Duplicate — 日本語", Body: ""},
		{Title: "Title on\ntwo lines", Body: "body ending in a newline\n"},
		{Title: "Title with\n\na blank line", Body: "# Original heading\n\nbody"},
		{Title: strings.Repeat("界", 30), Body: "long Unicode filename boundary"},
		{Title: "Title with\n\na blank line", Body: "duplicate title"},
		{Title: "Note 2", Body: "claims a suffix"},
		{Title: "Note", Body: "first"},
		{Title: "Note", Body: "second"},
	}
	var archive bytes.Buffer
	if err := export.Build(&archive, original, nil, ""); err != nil {
		t.Fatalf("build export: %v", err)
	}

	parsed, err := importer.Parse(archive.Bytes(), "", importer.DefaultLimits())
	if err != nil {
		t.Fatalf("parse export: %v", err)
	}
	if len(parsed.Notes) != len(original) {
		t.Fatalf("got %d notes, want %d", len(parsed.Notes), len(original))
	}
	for i := range original {
		if parsed.Notes[i].Title != original[i].Title {
			t.Errorf("note %d title = %q, want %q", i, parsed.Notes[i].Title, original[i].Title)
		}
		if parsed.Notes[i].Body != original[i].Body {
			t.Errorf("note %d body = %q, want %q", i, parsed.Notes[i].Body, original[i].Body)
		}
	}
}

func TestParse_BoundsEachEntryBeforeDecompression(t *testing.T) {
	for name, data := range map[string][]byte{
		"note.md":          []byte("# Note\n\n" + strings.Repeat("x", notes.MaxBodyLen+1000) + "\n"),
		"images/image.png": bytes.Repeat([]byte("x"), (10<<20)+1),
	} {
		_, err := importer.Parse(makeZIP(t, map[string][]byte{name: data}), "", importer.DefaultLimits())
		if err == nil || !strings.Contains(err.Error(), "entry exceeds") {
			t.Errorf("%s: expected per-entry limit error, got %v", name, err)
		}
	}
}

func TestParse_RejectsTruncatedDeflateAfterCompleteContent(t *testing.T) {
	data := makeZIP(t, map[string][]byte{"note.md": []byte("# Note\n\nbody\n")})
	central := bytes.LastIndex(data, []byte{'P', 'K', 1, 2})
	// Trim just the deflate end marker, leaving the full uncompressed text.
	// EOF from a successful bounded read must not mask io.ErrUnexpectedEOF.
	size := binary.LittleEndian.Uint32(data[central+20:])
	for trim := uint32(1); trim <= 5; trim++ {
		binary.LittleEndian.PutUint32(data[central+20:], size-trim)
		_, err := importer.Parse(data, "", importer.DefaultLimits())
		if err == nil {
			t.Errorf("accepted deflate data truncated by %d bytes", trim)
		}
	}
}

func TestParse_RejectsForgedCentralDirectoryCount(t *testing.T) {
	data := makeZIP(t, map[string][]byte{"note.md": []byte("# Note\n\nbody\n")})
	end := bytes.LastIndex(data, []byte{'P', 'K', 5, 6})
	binary.LittleEndian.PutUint16(data[end+8:], 0)
	binary.LittleEndian.PutUint16(data[end+10:], 0)
	_, err := importer.Parse(data, "", importer.DefaultLimits())
	if err == nil {
		t.Fatal("accepted a forged central directory count")
	}
}

func TestParse_RejectsAmbiguousTitleBoundaries(t *testing.T) {
	for _, note := range []*notes.Note{
		{Title: "Note\n", Body: "body"},
		{Title: "Note", Body: "\nbody"},
		{Title: "Note\n\n", Body: "body"},
		{Title: strings.Repeat("a", 80) + "\n\nrest", Body: "body"},
	} {
		var archive bytes.Buffer
		if err := export.Build(&archive, []*notes.Note{note}, nil, ""); err != nil {
			t.Fatal(err)
		}
		_, err := importer.Parse(archive.Bytes(), "", importer.DefaultLimits())
		if err == nil || !strings.Contains(err.Error(), "ambiguous title/body boundary") {
			t.Fatalf("title %q, body %q: expected actionable ambiguity error, got %v", note.Title, note.Body, err)
		}
	}
}

func TestParse_RejectsUnsafeUnsupportedAndOversizedArchives(t *testing.T) {
	tests := []struct {
		name    string
		data    func(*testing.T) []byte
		limits  importer.Limits
		wantErr string
	}{
		{
			name: "no notes",
			data: func(t *testing.T) []byte {
				return makeZIP(t, map[string][]byte{"images/image.png": testPNG()})
			},
			limits:  importer.DefaultLimits(),
			wantErr: importer.ErrNoNotes.Error(),
		},
		{
			name: "traversal path",
			data: func(t *testing.T) []byte {
				return makeZIP(t, map[string][]byte{"../note.md": []byte("# Note\n\nbody\n")})
			},
			limits:  importer.DefaultLimits(),
			wantErr: "invalid archive entry",
		},
		{
			name: "absolute path",
			data: func(t *testing.T) []byte {
				return makeZIP(t, map[string][]byte{"/note.md": []byte("# Note\n\nbody\n")})
			},
			limits:  importer.DefaultLimits(),
			wantErr: "invalid archive entry",
		},
		{
			name: "unsupported nested file",
			data: func(t *testing.T) []byte {
				return makeZIP(t, map[string][]byte{"folder/note.md": []byte("# Note\n\nbody\n")})
			},
			limits:  importer.DefaultLimits(),
			wantErr: "unsupported archive entry",
		},
		{
			name: "entry count",
			data: func(t *testing.T) []byte {
				return makeZIP(t, map[string][]byte{
					"one.md": []byte("# One\n\n\n"),
					"two.md": []byte("# Two\n\n\n"),
				})
			},
			limits:  importer.Limits{MaxEntries: 1, MaxTotalBytes: 100},
			wantErr: "too many entries",
		},
		{
			name: "decompressed bytes",
			data: func(t *testing.T) []byte {
				return makeZIP(t, map[string][]byte{"note.md": []byte("# Note\n\n" + strings.Repeat("x", 100) + "\n")})
			},
			limits:  importer.Limits{MaxEntries: 1, MaxTotalBytes: 20},
			wantErr: "expands beyond",
		},
		{
			name:    "corrupt data",
			data:    func(*testing.T) []byte { return []byte("not a zip") },
			limits:  importer.DefaultLimits(),
			wantErr: "invalid or corrupt ZIP",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := importer.Parse(tc.data(t), "", tc.limits)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error = %v, want message containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestParse_EncryptedExportReportsPasswordErrors(t *testing.T) {
	var archive bytes.Buffer
	if err := export.Build(&archive, []*notes.Note{{Title: "Secret", Body: "body"}}, nil, "correct"); err != nil {
		t.Fatalf("build export: %v", err)
	}

	if _, err := importer.Parse(archive.Bytes(), "", importer.DefaultLimits()); !errors.Is(err, importer.ErrPasswordRequired) {
		t.Fatalf("missing password error = %v", err)
	}
	if _, err := importer.Parse(archive.Bytes(), "wrong", importer.DefaultLimits()); !errors.Is(err, importer.ErrDecrypt) {
		t.Fatalf("wrong password error = %v", err)
	}
	if _, err := importer.Parse(archive.Bytes(), "correct", importer.DefaultLimits()); err != nil {
		t.Fatalf("correct password: %v", err)
	}
}
