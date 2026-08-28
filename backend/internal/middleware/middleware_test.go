package middleware_test

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/middleware"
)

func okHandler(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }

// ── Logging middleware ────────────────────────────────────────────────────────

func TestLogging_WritesMethodPathStatus(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	h := middleware.Logging(logger)(http.HandlerFunc(okHandler))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/health", nil))

	line := buf.String()
	for _, want := range []string{"method=GET", "path=/api/health", "status=200"} {
		if !strings.Contains(line, want) {
			t.Errorf("log line missing %q\ngot: %s", want, line)
		}
	}
}

func TestLogging_IncludesUserIDWhenAuthenticated(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	h := middleware.Logging(logger)(http.HandlerFunc(okHandler))

	req := httptest.NewRequest(http.MethodGet, "/api/notes", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.User{ID: 42}))
	h.ServeHTTP(httptest.NewRecorder(), req)

	if !strings.Contains(buf.String(), "user_id=42") {
		t.Errorf("expected user_id=42 in log line\ngot: %s", buf.String())
	}
}

func TestLogging_OmitsUserIDWhenUnauthenticated(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	h := middleware.Logging(logger)(http.HandlerFunc(okHandler))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if strings.Contains(buf.String(), "user_id") {
		t.Errorf("unexpected user_id in unauthenticated log\ngot: %s", buf.String())
	}
}

func TestLogging_CapturesNonOKStatus(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	notFound := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	h := middleware.Logging(logger)(notFound)

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/missing", nil))

	if !strings.Contains(buf.String(), "status=404") {
		t.Errorf("expected status=404 in log\ngot: %s", buf.String())
	}
}

func TestLogging_WritesDurationMs(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	h := middleware.Logging(logger)(http.HandlerFunc(okHandler))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if !strings.Contains(buf.String(), "duration_ms=") {
		t.Errorf("expected duration_ms field in log\ngot: %s", buf.String())
	}
}

// ── Metrics middleware ────────────────────────────────────────────────────────

// metricsOutput scrapes the /metrics endpoint and returns the body.
func metricsOutput(t *testing.T) string {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle("/metrics", middleware.MetricsHandler())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("metrics endpoint returned %d", w.Code)
	}
	return w.Body.String()
}

func TestMetrics_EndpointExposesRequestMetrics(t *testing.T) {
	h := middleware.Metrics()(http.HandlerFunc(okHandler))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/health", nil))

	body := metricsOutput(t)
	for _, want := range []string{
		"crapnote_http_requests_total",
		"crapnote_http_request_duration_seconds",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics output missing %q", want)
		}
	}
}

func TestMetrics_NormalisesNumericPathSegments(t *testing.T) {
	h := middleware.Metrics()(http.HandlerFunc(okHandler))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/notes/123", nil))

	body := metricsOutput(t)
	if !strings.Contains(body, `path="/api/notes/{id}"`) {
		t.Errorf("expected normalised label path=\"/api/notes/{id}\" in metrics output")
	}
	if strings.Contains(body, `path="/api/notes/123"`) {
		t.Error("raw numeric path /api/notes/123 must not appear as a metric label")
	}
}

func TestMetrics_NormalisesNestedNumericSegments(t *testing.T) {
	h := middleware.Metrics()(http.HandlerFunc(okHandler))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodDelete, "/api/notes/7/tags/3", nil))

	body := metricsOutput(t)
	if !strings.Contains(body, `path="/api/notes/{id}/tags/{id}"`) {
		t.Errorf("expected doubly-normalised path in metrics output")
	}
}

// ── Security headers middleware ───────────────────────────────────────────────

func TestSecurityHeaders_SetsRequiredHeaders(t *testing.T) {
	h := middleware.SecurityHeaders()(http.HandlerFunc(okHandler))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	want := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "strict-origin-when-cross-origin",
	}
	for header, wantVal := range want {
		if got := w.Header().Get(header); got != wantVal {
			t.Errorf("header %s: want %q, got %q", header, wantVal, got)
		}
	}
}

func TestSecurityHeaders_PassesThroughResponse(t *testing.T) {
	notFound := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})
	h := middleware.SecurityHeaders()(notFound)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/nope", nil))
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 passthrough, got %d", w.Code)
	}
}

// csp returns the Content-Security-Policy header set by SecurityHeaders for a
// request to path.
func csp(t *testing.T, path string) string {
	t.Helper()
	h := middleware.SecurityHeaders()(http.HandlerFunc(okHandler))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w.Header().Get("Content-Security-Policy")
}

func TestSecurityHeaders_SetsContentSecurityPolicy(t *testing.T) {
	policy := csp(t, "/")
	if policy == "" {
		t.Fatal("Content-Security-Policy header is not set")
	}

	// The baseline from issue #45. Every one of these must survive any future
	// loosening of the policy for the SvelteKit build.
	for _, directive := range []string{
		"default-src 'self'",
		"img-src 'self' data: blob:",
		"object-src 'none'",
		"base-uri 'none'",
		"frame-ancestors 'none'",
	} {
		if !strings.Contains(policy, directive) {
			t.Errorf("policy missing %q\ngot: %s", directive, policy)
		}
	}
}

func TestSecurityHeaders_CSPFrameAncestorsAgreesWithXFrameOptions(t *testing.T) {
	h := middleware.SecurityHeaders()(http.HandlerFunc(okHandler))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))

	// frame-ancestors is the modern replacement for X-Frame-Options; the two
	// must not drift apart or a proxy honouring only one gets a weaker answer.
	if got := w.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Fatalf("X-Frame-Options: want DENY, got %q", got)
	}
	if policy := w.Header().Get("Content-Security-Policy"); !strings.Contains(policy, "frame-ancestors 'none'") {
		t.Errorf("X-Frame-Options is DENY but CSP lacks frame-ancestors 'none'\ngot: %s", policy)
	}
}

func TestSecurityHeaders_CSPNeverAllowsUnsafeEval(t *testing.T) {
	// No part of the SvelteKit or Milkdown bundle needs eval(). If this ever
	// starts failing, find out what pulled eval in rather than relaxing it.
	if policy := csp(t, "/"); strings.Contains(policy, "unsafe-eval") {
		t.Errorf("policy must never permit 'unsafe-eval'\ngot: %s", policy)
	}
}

func TestSecurityHeaders_CSPPinsExfiltrationChannelsToSelf(t *testing.T) {
	policy := csp(t, "/")

	// script-src carries 'unsafe-inline' (SvelteKit emits an inline bootstrap
	// whose hash changes every build), so these directives are what actually
	// stops injected script phoning data home. They must stay first-party.
	for _, directive := range []string{
		"connect-src 'self'",
		"form-action 'self'",
	} {
		if !strings.Contains(policy, directive) {
			t.Errorf("policy missing %q\ngot: %s", directive, policy)
		}
	}
}

func TestSecurityHeaders_CSPConfinesUnsafeInlineToScriptAndStyle(t *testing.T) {
	policy := csp(t, "/")

	// 'unsafe-inline' is granted only where the SvelteKit build forces it (see
	// the reasoning on contentSecurityPolicy). Count the grants so a future
	// edit cannot quietly spread it to another directive.
	if got := strings.Count(policy, "'unsafe-inline'"); got != 2 {
		t.Errorf("expected exactly 2 'unsafe-inline' grants (script-src, style-src), got %d\npolicy: %s", got, policy)
	}
	for _, directive := range []string{
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	} {
		if !strings.Contains(policy, directive) {
			t.Errorf("policy missing %q\ngot: %s", directive, policy)
		}
	}
}

func TestSecurityHeaders_CSPAllowsOnlyGoogleFontsOffSite(t *testing.T) {
	policy := csp(t, "/")

	// app.html pulls its webfonts from Google at runtime; nothing else may be
	// loaded off-origin. Any other https: origin appearing here is a mistake.
	allowed := map[string]bool{
		"https://fonts.googleapis.com": true,
		"https://fonts.gstatic.com":    true,
	}
	for _, origin := range regexp.MustCompile(`https?://[^\s;]+`).FindAllString(policy, -1) {
		if !allowed[origin] {
			t.Errorf("unexpected off-site origin %q in policy\ngot: %s", origin, policy)
		}
	}
}

func TestSecurityHeaders_CSPAppliesToAPIResponses(t *testing.T) {
	// SecurityHeaders is mounted globally, so JSON responses carry the policy
	// too. Harmless (a JSON body loads no subresources) and it keeps the
	// middleware free of path-sniffing.
	if policy := csp(t, "/api/notes"); policy == "" {
		t.Error("expected the CSP header on API responses as well as the SPA")
	}
}

func TestMetrics_SkipsMetricsEndpointItself(t *testing.T) {
	h := middleware.Metrics()(http.HandlerFunc(okHandler))
	// Route a request to /metrics through the middleware — it must not self-record.
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/metrics", nil))

	body := metricsOutput(t)
	if strings.Contains(body, `path="/metrics"`) {
		t.Error("metrics endpoint must not instrument itself")
	}
}
