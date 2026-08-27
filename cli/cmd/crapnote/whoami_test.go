package main

import (
	"net/http"
	"strings"
	"testing"
)

func TestWhoamiPrintsUserAndRole(t *testing.T) {
	srv := newAPIServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/auth/me" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":3,"username":"dan","is_admin":true,"api_tokens_enabled":true,"created_at":"2026-01-01T00:00:00Z"}`))
	})

	stdout, stderr, code := runCLI(t, nil, "--url", srv.URL, "--token", "t", "whoami")
	if code != 0 {
		t.Fatalf("exit code = %d (stderr: %s)", code, stderr)
	}
	if !strings.Contains(stdout, "dan") || !strings.Contains(stdout, "admin") {
		t.Errorf("stdout = %q, want username and role", stdout)
	}
}

func TestWhoamiRejectsArguments(t *testing.T) {
	_, _, code := runCLI(t, nil, "--url", "http://x", "--token", "t", "whoami", "extra")
	if code != exitUsage {
		t.Errorf("exit code = %d, want usage error", code)
	}
}
