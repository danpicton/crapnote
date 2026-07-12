package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

const testTagJSON = `{"id":3,"name":"work","note_count":2,"created_at":"2026-01-01T00:00:00Z"}`

func TestTagsListShowsTagsWithCounts(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/tags" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`[` + testTagJSON + `]`))
	})

	stdout, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "tags", "list")
	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	if !strings.Contains(stdout, "work") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestTagsCreatePostsName(t *testing.T) {
	var gotBody []byte
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(testTagJSON))
	})

	_, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "tags", "create", "work")
	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	var sent map[string]string
	_ = json.Unmarshal(gotBody, &sent)
	if sent["name"] != "work" {
		t.Errorf("sent %v", sent)
	}
}

func TestTagsRenameAndDelete(t *testing.T) {
	var reqs []string
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		reqs = append(reqs, r.Method+" "+r.URL.Path)
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		_, _ = w.Write([]byte(testTagJSON))
	})

	if _, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "tags", "rename", "3", "life"); code != 0 {
		t.Fatalf("rename exit = %d", code)
	}
	if _, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "tags", "delete", "3"); code != 0 {
		t.Fatalf("delete exit = %d", code)
	}
	want := []string{"PUT /api/tags/3", "DELETE /api/tags/3"}
	if len(reqs) != 2 || reqs[0] != want[0] || reqs[1] != want[1] {
		t.Errorf("requests = %v, want %v", reqs, want)
	}
}

func TestNotesTagAttachesAndUntagRemoves(t *testing.T) {
	var reqs []string
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		reqs = append(reqs, r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	})

	if _, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "notes", "tag", "7", "3"); code != 0 {
		t.Fatalf("tag exit = %d", code)
	}
	if _, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "notes", "untag", "7", "3"); code != 0 {
		t.Fatalf("untag exit = %d", code)
	}
	want := []string{"POST /api/notes/7/tags", "DELETE /api/notes/7/tags/3"}
	if len(reqs) != 2 || reqs[0] != want[0] || reqs[1] != want[1] {
		t.Errorf("requests = %v, want %v", reqs, want)
	}
}

func TestNotesTagsListsTagsOnNote(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/notes/7/tags" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`[` + testTagJSON + `]`))
	})

	stdout, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "notes", "tags", "7", "--json")
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if !strings.Contains(stdout, `"name": "work"`) {
		t.Errorf("stdout = %s", stdout)
	}
}

func TestNotesListFiltersByTagAndStarred(t *testing.T) {
	var gotQuery string
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		_, _ = w.Write([]byte(`[]`))
	})

	_, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t",
		"notes", "list", "--tag", "3", "--starred", "--json")
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if !strings.Contains(gotQuery, "tag=3") || !strings.Contains(gotQuery, "starred=true") {
		t.Errorf("query = %q, want tag=3 and starred=true", gotQuery)
	}
}
