package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// runCLI invokes the CLI entrypoint the way main() does, capturing
// stdout/stderr and the exit code. env supplies fake environment variables.
func runCLI(t *testing.T, env map[string]string, args ...string) (stdout, stderr string, code int) {
	t.Helper()
	var out, errOut bytes.Buffer
	getenv := func(k string) string { return env[k] }
	code = run(args, &out, &errOut, getenv)
	return out.String(), errOut.String(), code
}

func newAPIServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv
}

func TestNotesListJSONPrintsStructuredNotesToStdout(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/notes" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer cnp_fromflag" {
			t.Errorf("Authorization = %q, want token from flag", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id":1,"title":"First","body":"hi","starred":false,"pinned":false,
			"archived":false,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]`))
	})

	stdout, stderr, code := runCLI(t, nil,
		"--url", srv.URL, "--token", "cnp_fromflag", "notes", "list", "--json")

	if code != 0 {
		t.Fatalf("exit code = %d, want 0 (stderr: %s)", code, stderr)
	}
	var notes []map[string]any
	if err := json.Unmarshal([]byte(stdout), &notes); err != nil {
		t.Fatalf("stdout is not pure JSON: %v\n%s", err, stdout)
	}
	if len(notes) != 1 || notes[0]["title"] != "First" {
		t.Errorf("unexpected JSON output: %s", stdout)
	}
}

func TestTokenAndURLComeFromEnvWhenFlagsAbsent(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer cnp_fromenv" {
			t.Errorf("Authorization = %q, want token from CNP_TOKEN", got)
		}
		_, _ = w.Write([]byte(`[]`))
	})

	env := map[string]string{"CNP_TOKEN": "cnp_fromenv", "CRAPNOTE_URL": srv.URL}
	_, stderr, code := runCLI(t, env, "notes", "list", "--json")

	if code != 0 {
		t.Fatalf("exit code = %d, want 0 (stderr: %s)", code, stderr)
	}
}

func TestAuthFailureExitsCode3WithErrorOnStderr(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid api token"}`))
	})

	stdout, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "bad", "notes", "list")

	if code != 3 {
		t.Errorf("exit code = %d, want 3 for auth failure", code)
	}
	if stdout != "" {
		t.Errorf("stdout should be empty on error, got %q", stdout)
	}
	if !strings.Contains(stderr, "invalid api token") {
		t.Errorf("stderr %q should carry the server's error message", stderr)
	}
}

func TestUnknownCommandExitsCode2WithUsage(t *testing.T) {
	_, stderr, code := runCLI(t, nil, "frobnicate")

	if code != 2 {
		t.Errorf("exit code = %d, want 2 for usage error", code)
	}
	if !strings.Contains(stderr, "Usage") {
		t.Errorf("stderr should show usage, got %q", stderr)
	}
}
