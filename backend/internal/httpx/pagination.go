// Package httpx provides small HTTP helpers shared across handlers.
package httpx

import (
	"net"
	"net/http"
	"strconv"
	"strings"
)

// ClientIP returns a stable key identifying the requesting client. It prefers
// the first entry of X-Forwarded-For (set by a trusted reverse proxy), then
// X-Real-IP, and falls back to r.RemoteAddr. Deployments that sit directly
// on the public internet without a proxy should be aware that XFF is
// spoofable.
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// Defaults used by ParsePage when the caller omits query parameters.
const (
	DefaultPageSize = 50
	MaxPageSize     = 100
)

// Page holds the effective pagination parameters for a list request.
type Page struct {
	Limit  int
	Offset int
}

// ParsePage reads ?limit=&offset= from the request URL. Missing, invalid, or
// out-of-range values are replaced with safe defaults: Limit in [1,MaxPageSize]
// and Offset >= 0. This is a denial-of-service guard — no list endpoint may
// return an unbounded number of rows.
func ParsePage(r *http.Request) Page {
	p := Page{Limit: DefaultPageSize, Offset: 0}
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			if n > MaxPageSize {
				n = MaxPageSize
			}
			p.Limit = n
		}
	}
	if s := r.URL.Query().Get("offset"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= 0 {
			p.Offset = n
		}
	}
	return p
}
