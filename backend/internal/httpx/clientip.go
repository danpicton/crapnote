package httpx

import (
	"context"
	"net"
	"net/http"
	"strings"
)

// clientIPKey carries the proxy-resolved client IP in the request context.
type clientIPKey struct{}

// proxyTrustedKey marks a request as having arrived via a trusted proxy, so
// other forwarded headers (e.g. X-Forwarded-Proto) may be honoured too.
type proxyTrustedKey struct{}

// ClientIP returns a stable key identifying the requesting client.
//
// By default it is the host part of r.RemoteAddr — the connection's real
// peer. X-Forwarded-For and X-Real-IP are deliberately ignored because any
// client can set them: trusting them lets an attacker pick their own
// rate-limit bucket and forge the IP recorded in audit logs.
//
// Deployments behind a trusted reverse proxy opt in by wrapping the handler
// chain with TrustProxy (TRUST_PROXY env var); ClientIP then returns the IP
// that middleware resolved from the forwarded headers.
func ClientIP(r *http.Request) string {
	if ip, ok := r.Context().Value(clientIPKey{}).(string); ok && ip != "" {
		return ip
	}
	return remoteHost(r)
}

// ProxyTrusted reports whether the request passed through the TrustProxy
// middleware, i.e. forwarded headers set by the proxy may be honoured.
func ProxyTrusted(r *http.Request) bool {
	trusted, _ := r.Context().Value(proxyTrustedKey{}).(bool)
	return trusted
}

// TrustProxy returns middleware for deployments behind exactly one trusted
// reverse proxy. It resolves the client IP that ClientIP will return for the
// request, using the rightmost X-Forwarded-For entry — the one appended by
// the trusted proxy itself, which a client cannot influence. Entries further
// left may be attacker-supplied and are ignored. X-Real-IP is used when
// X-Forwarded-For is absent, and the RemoteAddr host remains the fallback.
//
// Do not enable this without a proxy in front: the headers would be
// client-controlled and spoofable again.
func TrustProxy() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), clientIPKey{}, forwardedIP(r))
			ctx = context.WithValue(ctx, proxyTrustedKey{}, true)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// forwardedIP picks the client IP from proxy-set headers, falling back to
// the RemoteAddr host.
func forwardedIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		entries := strings.Split(xff, ",")
		if ip := strings.TrimSpace(entries[len(entries)-1]); ip != "" {
			return ip
		}
	}
	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
		return xri
	}
	return remoteHost(r)
}

// remoteHost returns the host part of r.RemoteAddr, tolerating values
// without a port.
func remoteHost(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
