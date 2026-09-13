package version

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckerReportsNewerReleaseAsAvailable(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"name":"v2.2.0"},{"name":"cli/v9.0.0"},{"name":"v2.1.0"}]`))
	}))
	defer upstream.Close()

	checker := NewChecker("v2.1.0", upstream.URL, upstream.Client())
	status := checker.Status(t.Context())

	if status.Version != "v2.1.0" {
		t.Fatalf("version = %q, want v2.1.0", status.Version)
	}
	if status.LatestVersion != "v2.2.0" {
		t.Fatalf("latest_version = %q, want v2.2.0", status.LatestVersion)
	}
	if !status.UpdateAvailable {
		t.Fatal("expected update_available=true")
	}
}

func TestCheckerCachesTheLatestRelease(t *testing.T) {
	requests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		_, _ = w.Write([]byte(`[{"name":"v2.2.0"}]`))
	}))
	defer upstream.Close()

	checker := NewChecker("v2.1.0", upstream.URL, upstream.Client())
	checker.Status(t.Context())
	checker.Status(t.Context())

	if requests != 1 {
		t.Fatalf("upstream requests = %d, want 1", requests)
	}
}
