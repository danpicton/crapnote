// Package ratelimit provides a simple in-memory per-key token-bucket rate
// limiter and HTTP middleware. It is intentionally dependency-free and suited
// to single-process deployments; a distributed setup would need a shared store.
package ratelimit

import (
	"net/http"
	"sync"
	"time"

	"github.com/danpicton/crapnote/internal/httpx"
)

// Limiter is an in-memory per-key token-bucket rate limiter.
type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	burst   float64 // max tokens (bucket capacity)
	ttl     time.Duration
	lastGC  time.Time
	now     func() time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

// New returns a Limiter with the given refill rate (tokens/sec) and burst.
func New(ratePerSecond float64, burst int) *Limiter {
	return &Limiter{
		buckets: map[string]*bucket{},
		rate:    ratePerSecond,
		burst:   float64(burst),
		ttl:     10 * time.Minute,
		now:     time.Now,
	}
}

// SetTTL configures how long an idle bucket may live before being pruned.
func (l *Limiter) SetTTL(ttl time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.ttl = ttl
}

// Size returns the number of tracked buckets (for tests/metrics).
func (l *Limiter) Size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

// Allow reports whether a request from key is permitted now.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.gcLocked(now)

	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	} else {
		elapsed := now.Sub(b.last).Seconds()
		b.tokens += elapsed * l.rate
		if b.tokens > l.burst {
			b.tokens = l.burst
		}
		b.last = now
	}

	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}

// gcLocked removes buckets that have been idle for longer than ttl.
// Caller must hold l.mu. Runs at most once per ttl interval to keep Allow O(1)
// amortised.
func (l *Limiter) gcLocked(now time.Time) {
	if now.Sub(l.lastGC) < l.ttl {
		return
	}
	l.lastGC = now
	for k, b := range l.buckets {
		if now.Sub(b.last) > l.ttl {
			delete(l.buckets, k)
		}
	}
}

// ClientIP is a re-export of httpx.ClientIP kept for callers that already
// wire ratelimit.Middleware; new code should import httpx directly.
func ClientIP(r *http.Request) string {
	return httpx.ClientIP(r)
}

// Middleware returns HTTP middleware that denies requests with 429 when the
// per-key limiter is exhausted. key is derived from the request via keyFn.
func Middleware(l *Limiter, keyFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.Allow(keyFn(r)) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "60")
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":"too many requests"}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
