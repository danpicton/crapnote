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

// SecurityHeaders returns middleware that sets security-related response headers
// on every response to defend against common browser-based attacks.
func SecurityHeaders() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
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
