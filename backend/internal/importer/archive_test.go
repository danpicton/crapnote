package importer_test

import (
	"bytes"
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
