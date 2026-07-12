package main

import (
	"net/http"
	"strings"
	"testing"
)

func TestSearchReturnsMatchingNotesViaFTSQueryParam(t *testing.T) {
	var gotQuery string
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/notes" {
			t.Errorf("path = %s, want /api/notes (search is a notes filter, not its own endpoint)", r.URL.Path)
		}
		gotQuery = r.URL.Query().Get("search")
		_, _ = w.Write([]byte(`[` + testNoteJSON + `]`))
	})

	stdout, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t",
		"search", "meeting notes", "--json")

	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	if gotQuery != "meeting notes" {
		t.Errorf("search param = %q, want the full query string", gotQuery)
	}
	if !strings.Contains(stdout, `"id": 7`) {
		t.Errorf("stdout = %s", stdout)
	}
}

func TestSearchWithoutQueryIsUsageError(t *testing.T) {
	_, _, code := runCLI(t, nil, "--url", "http://unused", "--token", "t", "search")
	if code != 2 {
		t.Errorf("exit = %d, want 2", code)
	}
}

func TestArchiveListShowsArchivedNotes(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/archive" {
			t.Errorf("path = %s, want /api/archive", r.URL.Path)
		}
		_, _ = w.Write([]byte(`[` + testNoteJSON + `]`))
	})

	stdout, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t",
		"archive", "list", "--json")
	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	if !strings.Contains(stdout, `"title": "T"`) {
		t.Errorf("stdout = %s", stdout)
	}
}
