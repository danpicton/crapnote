package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/cli/client"
)

const testNoteJSON = `{"id":7,"title":"T","body":"B","starred":false,"pinned":true,
	"archived":false,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}`

func TestNotesCreateSendsTitleAndBodyFlag(t *testing.T) {
	var gotBody []byte
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(testNoteJSON))
	})

	stdout, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t",
		"notes", "create", "--title", "T", "--body", "B", "--json")

	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	var sent map[string]string
	_ = json.Unmarshal(gotBody, &sent)
	if sent["title"] != "T" || sent["body"] != "B" {
		t.Errorf("sent %v", sent)
	}
	if !strings.Contains(stdout, `"id": 7`) {
		t.Errorf("stdout should contain created note, got %s", stdout)
	}
}

func TestNotesGetPrintsNote(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/notes/7" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(testNoteJSON))
	})

	stdout, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t",
		"notes", "get", "7", "--json")
	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	if !strings.Contains(stdout, `"title": "T"`) {
		t.Errorf("stdout = %s", stdout)
	}
}

func TestNotesGetHumanOutputShowsTitleAndBody(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(testNoteJSON))
	})

	stdout, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "notes", "get", "7")
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if !strings.Contains(stdout, "T") || !strings.Contains(stdout, "B") {
		t.Errorf("human output should include title and body, got %q", stdout)
	}
}

func TestNotesUpdateSendsOnlyGivenFields(t *testing.T) {
	var gotBody []byte
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/api/notes/7" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		gotBody, _ = io.ReadAll(r.Body)
		_, _ = w.Write([]byte(testNoteJSON))
	})

	_, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t",
		"notes", "update", "7", "--title", "New")
	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	var sent map[string]any
	_ = json.Unmarshal(gotBody, &sent)
	if sent["title"] != "New" {
		t.Errorf("sent %v", sent)
	}
	if _, present := sent["body"]; present {
		t.Errorf("body must be omitted when not flagged, sent %v", sent)
	}
}

func TestNotesUpdateWithNoFieldsIsUsageError(t *testing.T) {
	_, _, code := runCLI(t, nil, "--url", "http://unused", "--token", "t",
		"notes", "update", "7")
	if code != 2 {
		t.Errorf("exit = %d, want 2 when nothing to update", code)
	}
}

func TestNotesDeleteMovesToTrash(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/notes/7" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	})

	stdout, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "notes", "delete", "7")
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if !strings.Contains(stdout, "trash") {
		t.Errorf("human confirmation should mention trash, got %q", stdout)
	}
}

func TestNotesStarTogglesAndReportsNewState(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/api/notes/7/star" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(strings.Replace(testNoteJSON, `"starred":false`, `"starred":true`, 1)))
	})

	stdout, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "notes", "star", "7")
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if !strings.Contains(stdout, "starred") {
		t.Errorf("stdout = %q, want new starred state", stdout)
	}
}

func TestNotesArchiveAndUnarchive(t *testing.T) {
	var paths []string
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	})

	if _, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "notes", "archive", "7"); code != 0 {
		t.Fatalf("archive exit = %d", code)
	}
	if _, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "notes", "unarchive", "7"); code != 0 {
		t.Fatalf("unarchive exit = %d", code)
	}
	if len(paths) != 2 || paths[0] != "/api/notes/7/archive" || paths[1] != "/api/notes/7/unarchive" {
		t.Errorf("paths = %v", paths)
	}
}

func TestWriteWithReadOnlyTokenExitsCode4On403(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"this api token is read-only"}`))
	})

	_, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "ro",
		"notes", "create", "--title", "x")
	if code != 4 {
		t.Errorf("exit = %d, want 4 for 403", code)
	}
	if !strings.Contains(stderr, "read-only") {
		t.Errorf("stderr should surface the server's 403 message, got %q", stderr)
	}
}

func TestNoteFlagsRendersEveryFlag(t *testing.T) {
	tests := []struct {
		name string
		note client.Note
		want string
	}{
		{"none", client.Note{}, "-"},
		{"pinned", client.Note{Pinned: true}, "P"},
		{"starred", client.Note{Starred: true}, "*"},
		{"archived", client.Note{Archived: true}, "A"},
		{"locked", client.Note{Locked: true}, "L"},
		{"all", client.Note{Pinned: true, Starred: true, Archived: true, Locked: true}, "P*AL"},
		{"pinned and locked", client.Note{Pinned: true, Locked: true}, "PL"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := noteFlags(tt.note); got != tt.want {
				t.Errorf("noteFlags = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNotesListShowsLockFlag(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"id":7,"title":"T","body":"","starred":false,"pinned":false,
			"archived":false,"locked":true,"created_at":"2026-01-01T00:00:00Z",
			"updated_at":"2026-01-01T00:00:00Z"}]`))
	})

	stdout, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "notes", "list")

	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	if !strings.Contains(stdout, "L") {
		t.Errorf("expected lock flag in listing, got:\n%s", stdout)
	}
}
