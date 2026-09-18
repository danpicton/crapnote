package importer_test

import (
	"bytes"
	"testing"

	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/importer"
	"github.com/danpicton/crapnote/internal/notes"
)

func TestParse_RoundTripsExportedNoteContent(t *testing.T) {
	original := []*notes.Note{
		{Title: "Duplicate — 日本語", Body: "First body\n\n# Original heading"},
		{Title: "Duplicate — 日本語", Body: ""},
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
