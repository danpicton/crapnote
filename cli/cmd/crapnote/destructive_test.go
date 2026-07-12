package main

import (
	"net/http"
	"strings"
	"testing"
)

// Destructive commands must not fire without --yes: a typo or shell-history
// recall must never irreversibly delete data (the web UI gates these behind
// a confirm dialog).
func TestDestructiveCommandsRequireYesFlag(t *testing.T) {
	var requests int
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusNoContent)
	})

	for _, args := range [][]string{
		{"trash", "empty"},
		{"trash", "purge", "7"},
		{"tokens", "revoke-all"},
	} {
		stdout, stderr, code := runCLI(t, nil, append([]string{"--url", srv.URL, "--token", "t"}, args...)...)
		if code != 2 {
			t.Errorf("%v: exit = %d, want 2 without --yes", args, code)
		}
		if stdout != "" {
			t.Errorf("%v: stdout should be empty, got %q", args, stdout)
		}
		if !strings.Contains(stderr, "--yes") {
			t.Errorf("%v: stderr %q should tell the user about --yes", args, stderr)
		}
	}
	if requests != 0 {
		t.Errorf("no HTTP requests should be made without --yes, got %d", requests)
	}
}

func TestDestructiveCommandsProceedWithYesFlag(t *testing.T) {
	var reqs []string
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		reqs = append(reqs, r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	})

	for _, args := range [][]string{
		{"trash", "empty", "--yes"},
		{"trash", "purge", "7", "--yes"},
		{"tokens", "revoke-all", "--yes"},
	} {
		if _, stderr, code := runCLI(t, nil, append([]string{"--url", srv.URL, "--token", "t"}, args...)...); code != 0 {
			t.Errorf("%v: exit = %d, stderr: %s", args, code, stderr)
		}
	}
	want := "DELETE /api/trash,DELETE /api/trash/7,POST /api/tokens/revoke-all"
	if strings.Join(reqs, ",") != want {
		t.Errorf("requests = %v, want %s", reqs, want)
	}
}

// The export password must be suppliable via env so it never appears in
// process listings or shell history.
func TestExportPasswordComesFromEnvWhenFlagAbsent(t *testing.T) {
	var gotBody string
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 1024)
		n, _ := r.Body.Read(buf)
		gotBody = string(buf[:n])
		w.Header().Set("Content-Type", "application/zip")
		_, _ = w.Write([]byte("PK\x03\x04zip"))
	})

	dir := t.TempDir()
	env := map[string]string{"CNP_EXPORT_PASSWORD": "from-env-secret"}
	_, stderr, code := runCLI(t, env, "--url", srv.URL, "--token", "t",
		"export", "-o", dir+"/out.zip")
	if code != 0 {
		t.Fatalf("exit = %d, stderr: %s", code, stderr)
	}
	if !strings.Contains(gotBody, `"password":"from-env-secret"`) {
		t.Errorf("request body %q should carry the env password", gotBody)
	}
}
