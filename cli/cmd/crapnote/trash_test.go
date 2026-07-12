package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTrashListShowsEntriesWithPurgeDeadline(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/trash" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`[{"note_id":7,"title":"Old","deleted_at":"2026-01-01T00:00:00Z",
			"permanent_delete_at":"2026-01-08T00:00:00Z"}]`))
	})

	stdout, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "trash", "list")
	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	if !strings.Contains(stdout, "Old") || !strings.Contains(stdout, "2026-01-08") {
		t.Errorf("stdout = %q, want title and purge deadline", stdout)
	}
}

func TestTrashRestorePurgeAndEmpty(t *testing.T) {
	var reqs []string
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		reqs = append(reqs, r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	})

	for _, args := range [][]string{
		{"trash", "restore", "7"},
		{"trash", "purge", "7", "--yes"},
		{"trash", "empty", "--yes"},
	} {
		if _, stderr, code := runCLI(t, nil, append([]string{"--url", srv.URL, "--token", "t"}, args...)...); code != 0 {
			t.Fatalf("%v exit = %d, stderr: %s", args, code, stderr)
		}
	}
	want := []string{"POST /api/trash/7/restore", "DELETE /api/trash/7", "DELETE /api/trash"}
	if strings.Join(reqs, ",") != strings.Join(want, ",") {
		t.Errorf("requests = %v, want %v", reqs, want)
	}
}

func TestExportWritesZipToFile(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/export" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/zip")
		_, _ = w.Write([]byte("PK\x03\x04zipbytes"))
	})

	out := filepath.Join(t.TempDir(), "backup.zip")
	stdout, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t",
		"export", "-o", out)
	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("output file: %v", err)
	}
	if !strings.HasPrefix(string(data), "PK") {
		t.Errorf("file content = %q, want ZIP bytes", data)
	}
	if !strings.Contains(stdout, out) {
		t.Errorf("stdout %q should name the output file", stdout)
	}
}

func TestTokensListShowsScopeAndPrefix(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/tokens" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`[{"id":1,"name":"laptop","prefix":"cnp_abc12345","scope":"read_write",
			"created_at":"2026-01-01T00:00:00Z"}]`))
	})

	stdout, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "tokens", "list")
	if code != 0 {
		t.Fatalf("exit = %d", code)
	}
	if !strings.Contains(stdout, "read_write") || !strings.Contains(stdout, "cnp_abc12345") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestTokensRevokeAndRevokeAll(t *testing.T) {
	var reqs []string
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		reqs = append(reqs, r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	})

	if _, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "tokens", "revoke", "1"); code != 0 {
		t.Fatalf("revoke exit = %d", code)
	}
	if _, _, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "tokens", "revoke-all", "--yes"); code != 0 {
		t.Fatalf("revoke-all exit = %d", code)
	}
	want := []string{"DELETE /api/tokens/1", "POST /api/tokens/revoke-all"}
	if strings.Join(reqs, ",") != strings.Join(want, ",") {
		t.Errorf("requests = %v, want %v", reqs, want)
	}
}

func TestTokensCreateExplainsCookieOnlyRestriction(t *testing.T) {
	// No server: the CLI must refuse locally with a helpful message, because
	// the API only mints tokens over a cookie session (never bearer auth).
	_, stderr, code := runCLI(t, nil, "--url", "http://unused", "--token", "t", "tokens", "create")
	if code != 2 {
		t.Errorf("exit = %d, want 2", code)
	}
	if !strings.Contains(stderr, "web UI") {
		t.Errorf("stderr %q should point at the web UI (Settings → Developer)", stderr)
	}
}
