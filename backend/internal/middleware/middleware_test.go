package middleware_test

import (
	"bytes"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
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

// parseCSP splits a Content-Security-Policy header into directive → sources.
// Assertions built on the parsed form see a directive's entire source list, so a
// loosening such as "connect-src 'self' https://evil.example" cannot slip past
// the way it slips past a strings.Contains check for "connect-src 'self'".
func parseCSP(t *testing.T, policy string) map[string][]string {
	t.Helper()
	if policy == "" {
		t.Fatal("Content-Security-Policy header is not set")
	}
	parsed := make(map[string][]string)
	for _, part := range strings.Split(policy, ";") {
		fields := strings.Fields(part)
		if len(fields) == 0 {
			continue
		}
		name := strings.ToLower(fields[0])
		if _, dup := parsed[name]; dup {
			t.Errorf("directive %q is listed twice; browsers honour only the first\npolicy: %s", name, policy)
		}
		parsed[name] = fields[1:]
	}
	return parsed
}

func sortedSources(in []string) []string {
	out := slices.Clone(in)
	slices.Sort(out)
	return out
}

// wantCSPDirectives is the policy the server is expected to send, directive by
// directive and source by source. The header owns exactly one directive:
// frame-ancestors, which browsers ignore in a <meta> tag and which therefore
// cannot live in the build-time half of the policy (frontend/svelte.config.js).
// Everything else — default-src, script-src and the rest — is emitted into
// index.html by SvelteKit, because only the build knows the SHA-256 of the
// inline bootstrap it generates. docs/csp.md records the whole split.
//
// The comparison is exact, not substring: adding any source to any directive
// fails here and has to be argued for in review.
var wantCSPDirectives = map[string][]string{
	"frame-ancestors": {"'none'"},
}

func TestSecurityHeaders_SetsContentSecurityPolicy(t *testing.T) {
	policy := csp(t, "/")
	got := parseCSP(t, policy)

	for _, name := range slices.Sorted(maps.Keys(wantCSPDirectives)) {
		sources, ok := got[name]
		if !ok {
			t.Errorf("policy is missing directive %q\ngot: %s", name, policy)
			continue
		}
		if !slices.Equal(sortedSources(sources), sortedSources(wantCSPDirectives[name])) {
			t.Errorf("directive %s: want sources %v, got %v\npolicy: %s",
				name, wantCSPDirectives[name], sources, policy)
		}
	}
	for _, name := range slices.Sorted(maps.Keys(got)) {
		if _, expected := wantCSPDirectives[name]; !expected {
			t.Errorf("unexpected directive %q in policy\ngot: %s", name, policy)
		}
	}
}

func TestSecurityHeaders_CSPLeavesResourceDirectivesToTheBuiltPolicy(t *testing.T) {
	// The SPA is governed by two policies at once — this header and the <meta>
	// tag SvelteKit bakes into index.html — and a resource must satisfy both.
	// So a resource directive added back here does not tighten anything: it
	// intersects with the built policy, and since this header can never carry
	// the per-build hash of SvelteKit's inline bootstrap, script-src or a
	// default-src standing in for it would block the bootstrap and leave the
	// SPA silently unbootable. Widen or tighten frontend/svelte.config.js
	// instead; see docs/csp.md.
	got := parseCSP(t, csp(t, "/"))
	for _, directive := range []string{
		"default-src", "script-src", "script-src-elem", "style-src", "font-src",
		"img-src", "connect-src", "object-src", "base-uri", "form-action",
	} {
		if sources, present := got[directive]; present {
			t.Errorf("%s is the built policy's to own, but the header sends %v", directive, sources)
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
	policy := parseCSP(t, w.Header().Get("Content-Security-Policy"))
	if sources := policy["frame-ancestors"]; !slices.Equal(sources, []string{"'none'"}) {
		t.Errorf("X-Frame-Options is DENY but frame-ancestors is %v, not exactly 'none'", sources)
	}
}

func TestSecurityHeaders_CSPGrantsNothing(t *testing.T) {
	// Everything this header sends is a denial. No source that permits
	// anything — an origin, a scheme, 'unsafe-inline', 'unsafe-eval' — belongs
	// in a policy whose only job is to say who may frame the app, and any such
	// source would also intersect with the built policy (see above).
	got := parseCSP(t, csp(t, "/"))
	for _, directive := range slices.Sorted(maps.Keys(got)) {
		for _, src := range got[directive] {
			if src != "'none'" {
				t.Errorf("directive %s permits %q; the header half of the policy only denies", directive, src)
			}
		}
	}
}

func TestSecurityHeaders_CSPAppliesToAPIResponses(t *testing.T) {
	// SecurityHeaders is mounted globally, so JSON responses carry the policy
	// too. Harmless (a JSON body loads no subresources) and it keeps the
	// middleware free of path-sniffing. It also means every response — not just
	// the SPA shell, which gets its frame-ancestors from here as well — refuses
	// to be framed.
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
