package ratelimit_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/internal/ratelimit"
)

func TestMiddleware_Returns429WhenExhausted(t *testing.T) {
	l := ratelimit.New(0.01, 1) // effectively 1 request then denied
	mw := ratelimit.Middleware(l, func(r *http.Request) string { return "k" })

	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	r1 := httptest.NewRequest(http.MethodPost, "/x", nil)
	w1 := httptest.NewRecorder()
	h.ServeHTTP(w1, r1)
	if w1.Code != http.StatusOK {
		t.Fatalf("first request: expected 200, got %d", w1.Code)
	}

	r2 := httptest.NewRequest(http.MethodPost, "/x", nil)
	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, r2)
	if w2.Code != http.StatusTooManyRequests {
		t.Fatalf("second request: expected 429, got %d", w2.Code)
	}
	if got := w2.Header().Get("Retry-After"); got == "" {
		t.Fatal("expected Retry-After header set on 429")
	}
}

func TestClientIP_PrefersXForwardedFor(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.1:1234"
	r.Header.Set("X-Forwarded-For", "203.0.113.5, 10.0.0.1")

	if got := ratelimit.ClientIP(r); got != "203.0.113.5" {
		t.Fatalf("expected 203.0.113.5, got %q", got)
	}
}

func TestClientIP_FallsBackToRemoteAddr(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.1:1234"

	if got := ratelimit.ClientIP(r); got != "10.0.0.1" {
		t.Fatalf("expected 10.0.0.1, got %q", got)
	}
}
