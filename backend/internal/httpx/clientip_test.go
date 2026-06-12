package httpx_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/internal/httpx"
)

func TestClientIP_Default_IgnoresForwardedHeaders(t *testing.T) {
	tests := []struct {
		name string
		set  map[string]string
	}{
		{name: "no headers", set: nil},
		{name: "X-Forwarded-For", set: map[string]string{"X-Forwarded-For": "203.0.113.5"}},
		{name: "X-Forwarded-For chain", set: map[string]string{"X-Forwarded-For": "203.0.113.5, 198.51.100.2"}},
		{name: "X-Real-IP", set: map[string]string{"X-Real-IP": "203.0.113.6"}},
		{name: "both headers", set: map[string]string{
			"X-Forwarded-For": "203.0.113.5",
			"X-Real-IP":       "203.0.113.6",
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = "10.0.0.1:1234"
			for k, v := range tc.set {
				r.Header.Set(k, v)
			}
			if got := httpx.ClientIP(r); got != "10.0.0.1" {
				t.Fatalf("expected RemoteAddr host 10.0.0.1, got %q", got)
			}
		})
	}
}

func TestClientIP_Default_RemoteAddrWithoutPort(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.1"
	if got := httpx.ClientIP(r); got != "10.0.0.1" {
		t.Fatalf("expected 10.0.0.1, got %q", got)
	}
}

// trustedClientIP runs a request through the TrustProxy middleware and
// returns what ClientIP resolved inside the handler.
func trustedClientIP(t *testing.T, configure func(r *http.Request)) string {
	t.Helper()
	var got string
	h := httpx.TrustProxy()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = httpx.ClientIP(r)
	}))
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = "10.0.0.1:1234"
	configure(r)
	h.ServeHTTP(httptest.NewRecorder(), r)
	return got
}

func TestClientIP_TrustProxy_UsesRightmostForwardedFor(t *testing.T) {
	// The rightmost entry is the one appended by the trusted proxy itself;
	// anything to its left is attacker-suppliable.
	got := trustedClientIP(t, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "6.6.6.6, 203.0.113.5")
	})
	if got != "203.0.113.5" {
		t.Fatalf("expected rightmost XFF entry 203.0.113.5, got %q", got)
	}
}

func TestClientIP_TrustProxy_SingleForwardedForEntry(t *testing.T) {
	got := trustedClientIP(t, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "203.0.113.5")
	})
	if got != "203.0.113.5" {
		t.Fatalf("expected 203.0.113.5, got %q", got)
	}
}

func TestClientIP_TrustProxy_FallsBackToXRealIP(t *testing.T) {
	got := trustedClientIP(t, func(r *http.Request) {
		r.Header.Set("X-Real-IP", "203.0.113.6")
	})
	if got != "203.0.113.6" {
		t.Fatalf("expected X-Real-IP 203.0.113.6, got %q", got)
	}
}

func TestClientIP_TrustProxy_NoHeaders_UsesRemoteAddr(t *testing.T) {
	got := trustedClientIP(t, func(r *http.Request) {})
	if got != "10.0.0.1" {
		t.Fatalf("expected RemoteAddr host 10.0.0.1, got %q", got)
	}
}

func TestProxyTrusted(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if httpx.ProxyTrusted(r) {
		t.Fatal("expected ProxyTrusted false without middleware")
	}

	var inside bool
	h := httpx.TrustProxy()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inside = httpx.ProxyTrusted(r)
	}))
	h.ServeHTTP(httptest.NewRecorder(), r)
	if !inside {
		t.Fatal("expected ProxyTrusted true inside TrustProxy middleware")
	}
}
