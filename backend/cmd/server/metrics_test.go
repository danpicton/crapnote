package main

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/middleware"
)

// discardLogger keeps serveMetrics' startup/error logging out of test output.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// The public listener must never expose Prometheus data. A bare 404 (rather
// than falling through to the SPA catch-all) also stops a misconfigured
// scraper from silently "succeeding" against an HTML page.
func TestMetrics_NotServedOnPublicMux(t *testing.T) {
	mux := newTestMux(t)

	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodHead} {
		req := httptest.NewRequest(method, "/metrics", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("%s /metrics = %d, want 404", method, w.Code)
		}
		if strings.Contains(w.Body.String(), "go_goroutines") {
			t.Errorf("%s /metrics leaked Prometheus exposition on the public mux", method)
		}
	}
}

// ServeMux matches "/metrics" exactly, so the trailing-slash form is a
// separate pattern: without its own registration it falls through to the SPA
// catch-all and answers 200 text/html — the same "appears to succeed" outcome
// the explicit 404 above exists to prevent.
func TestMetrics_TrailingSlashNotServedOnPublicMux(t *testing.T) {
	mux := newTestMux(t)

	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodHead} {
		req := httptest.NewRequest(method, "/metrics/", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("%s /metrics/ = %d, want 404", method, w.Code)
		}
		if ct := w.Header().Get("Content-Type"); strings.HasPrefix(ct, "text/html") {
			t.Errorf("%s /metrics/ fell through to the SPA catch-all (Content-Type %q)", method, ct)
		}
		if strings.Contains(w.Body.String(), "go_goroutines") {
			t.Errorf("%s /metrics/ leaked Prometheus exposition on the public mux", method)
		}
	}
}

// Default config (METRICS_ADDR unset) starts no metrics listener at all.
func TestServeMetrics_DisabledByDefault(t *testing.T) {
	srv, err := serveMetrics("", discardLogger())
	if err != nil {
		t.Fatalf("serveMetrics(\"\") returned error: %v", err)
	}
	if srv != nil {
		t.Fatalf("serveMetrics(\"\") started a listener on %q, want none", srv.Addr)
	}
}

// With METRICS_ADDR set, /metrics is reachable on that separate listener and
// reports the app's own counters — the coverage the public endpoint used to
// provide.
func TestServeMetrics_ServesOnConfiguredAddr(t *testing.T) {
	srv, err := serveMetrics("127.0.0.1:0", discardLogger())
	if err != nil {
		t.Fatalf("serveMetrics: %v", err)
	}
	if srv == nil {
		t.Fatal("serveMetrics returned no server for a configured address")
	}
	t.Cleanup(func() { srv.Close() })

	// Drive one request through the metrics middleware so an application
	// counter exists to scrape.
	instrumented := middleware.Metrics()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	instrumented.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/health", nil))

	resp, err := http.Get("http://" + srv.Addr + "/metrics")
	if err != nil {
		t.Fatalf("scrape metrics listener: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /metrics on metrics listener = %d, want 200", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read metrics body: %v", err)
	}
	if !strings.Contains(string(body), "crapnote_http_requests_total") {
		t.Errorf("metrics body missing crapnote_http_requests_total:\n%s", body)
	}
}

// The metrics listener serves nothing but /metrics — it is not a second copy
// of the app.
func TestServeMetrics_ServesNothingElse(t *testing.T) {
	srv, err := serveMetrics("127.0.0.1:0", discardLogger())
	if err != nil {
		t.Fatalf("serveMetrics: %v", err)
	}
	t.Cleanup(func() { srv.Close() })

	for _, path := range []string{"/", "/api/health", "/api/notes"} {
		resp, err := http.Get("http://" + srv.Addr + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s on metrics listener = %d, want 404", path, resp.StatusCode)
		}
	}
}

// A bad METRICS_ADDR is an operator misconfiguration, not a silent no-op:
// serveMetrics reports it so main can fail fast instead of pretending metrics
// are being exported.
func TestServeMetrics_ReportsBindFailure(t *testing.T) {
	if _, err := serveMetrics("not-an-address", discardLogger()); err == nil {
		t.Fatal("expected an error for an unbindable address, got nil")
	}
}
