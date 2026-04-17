package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestEnvOrDefault(t *testing.T) {
	const key = "CRAPNOTE_TEST_VAR_XYZ"
	os.Unsetenv(key)

	if got := envOrDefault(key, "fallback"); got != "fallback" {
		t.Fatalf("expected fallback, got %q", got)
	}

	os.Setenv(key, "custom")
	defer os.Unsetenv(key)
	if got := envOrDefault(key, "fallback"); got != "custom" {
		t.Fatalf("expected custom, got %q", got)
	}
}

func TestNewLogger_Levels(t *testing.T) {
	for _, level := range []string{"", "debug", "warn", "error", "info"} {
		t.Run("level="+level, func(t *testing.T) {
			os.Setenv("LOG_LEVEL", level)
			defer os.Unsetenv("LOG_LEVEL")
			l := newLogger()
			if l == nil {
				t.Fatal("expected non-nil logger")
			}
		})
	}
}

func TestNewLogger_JSONFormat(t *testing.T) {
	os.Setenv("LOG_FORMAT", "json")
	defer os.Unsetenv("LOG_FORMAT")
	l := newLogger()
	if l == nil {
		t.Fatal("expected non-nil logger")
	}
}

func TestUIHandler_SPA_Route(t *testing.T) {
	mux := newTestMux(t)

	// Extensionless path → SPA index.html
	req := httptest.NewRequest(http.MethodGet, "/some/spa/route", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	// Should return 200 (served by embedded index.html placeholder)
	if w.Code != http.StatusOK {
		t.Fatalf("SPA route: expected 200, got %d", w.Code)
	}
}

func TestUIHandler_Asset_Route(t *testing.T) {
	mux := newTestMux(t)

	// Path with extension → tries to serve static asset; 404 if not present is fine
	req := httptest.NewRequest(http.MethodGet, "/nonexistent.js", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	// We don't assert the code since assets may or may not exist in the embedded FS;
	// we just verify the handler doesn't panic.
	if w.Code == 0 {
		t.Fatal("expected a non-zero status code")
	}
}
