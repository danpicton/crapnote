package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/danpicton/crapnote/internal/httpx"
)

type contextKey string

const (
	userContextKey         contextKey = "auth_user"
	authFlagsContextKey    contextKey = "auth_flags"
)

// authFlags captures who authorised a request and what they're permitted to
// do. It lives on request context alongside the User. Cookie-authenticated
// requests have ViaBearer=false and WriteAllowed=true (browser sessions have
// full permissions); bearer-authenticated requests get the scope the token
// was issued with.
type authFlags struct {
	ViaBearer    bool
	WriteAllowed bool
}

// WithUser returns a new context carrying the authenticated user.
func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, userContextKey, u)
}

// UserFromContext retrieves the authenticated user from context, or nil.
func UserFromContext(ctx context.Context) *User {
	u, _ := ctx.Value(userContextKey).(*User)
	return u
}

// WithAuthFlags attaches authorisation flags to context.
func WithAuthFlags(ctx context.Context, viaBearer, writeAllowed bool) context.Context {
	return context.WithValue(ctx, authFlagsContextKey, authFlags{
		ViaBearer:    viaBearer,
		WriteAllowed: writeAllowed,
	})
}

// IsBearerAuth reports whether the request was authenticated via a bearer
// token (rather than a session cookie).
func IsBearerAuth(ctx context.Context) bool {
	f, _ := ctx.Value(authFlagsContextKey).(authFlags)
	return f.ViaBearer
}

// WriteAllowed reports whether the caller is permitted to mutate state. True
// for cookie auth and for bearer tokens with read_write scope.
func WriteAllowed(ctx context.Context) bool {
	f, ok := ctx.Value(authFlagsContextKey).(authFlags)
	if !ok {
		// No flags set: assume full access (legacy paths that only wired
		// RequireAuth pre-bearer stay behaving as before).
		return true
	}
	return f.WriteAllowed
}

// BearerAuthenticator verifies a raw bearer token and returns the associated
// user, scope ("read" or "read_write"), and token ID. The tokens package
// implements this; auth depends on the interface to avoid a cycle.
type BearerAuthenticator interface {
	AuthenticateBearer(ctx context.Context, raw string) (user *User, scope string, tokenID int64, err error)
	RecordTokenUsage(tokenID int64)
}

// SetBearerAuthenticator wires an optional bearer verifier. If nil, bearer
// auth is disabled and Authorization headers are ignored.
func (h *Handler) SetBearerAuthenticator(b BearerAuthenticator) {
	h.bearer = b
}

// RequireAuth is middleware that validates either an Authorization: Bearer
// header or a session cookie, and injects the user into the request context.
// Returns 401 if both are missing or invalid.
func (h *Handler) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if raw, ok := bearerFromRequest(r); ok {
			if h.bearer == nil {
				writeError(w, http.StatusUnauthorized, "bearer authentication disabled")
				return
			}
			user, scope, tokenID, err := h.bearer.AuthenticateBearer(r.Context(), raw)
			if err != nil {
				slog.Warn("audit: bearer auth failed",
					"event", "bearer_auth_failed",
					"ip", httpx.ClientIP(r),
				)
				writeError(w, http.StatusUnauthorized, "invalid api token")
				return
			}
			h.bearer.RecordTokenUsage(tokenID)
			ctx := WithUser(r.Context(), user)
			ctx = WithAuthFlags(ctx, true, scope == "read_write")
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		cookie, err := r.Cookie("session")
		if err != nil {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}

		user, err := h.svc.ValidateSession(r.Context(), cookie.Value)
		if errors.Is(err, ErrNotFound) {
			writeError(w, http.StatusUnauthorized, "session expired or invalid")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		ctx := WithUser(r.Context(), user)
		ctx = WithAuthFlags(ctx, false, true)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAdmin is middleware that enforces admin access after RequireAuth.
// Must be chained after RequireAuth. Bearer-authenticated requests are
// rejected even when the underlying user is an admin: admin capabilities are
// deliberately scoped to browser sessions so a leaked API token cannot, for
// example, create users or disable the api_tokens_enabled flag on others.
func (h *Handler) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromContext(r.Context())
		if u == nil || !u.IsAdmin {
			writeError(w, http.StatusForbidden, "admin access required")
			return
		}
		if IsBearerAuth(r.Context()) {
			writeError(w, http.StatusForbidden, "admin endpoints are not available via api tokens")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireWrite rejects requests from bearer tokens issued with read-only
// scope. Must be chained after RequireAuth. Cookie auth always passes.
func (h *Handler) RequireWrite(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !WriteAllowed(r.Context()) {
			writeError(w, http.StatusForbidden, "this api token is read-only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// bearerFromRequest extracts the raw token from an Authorization: Bearer
// header. Returns ok=false if the header is missing or malformed.
func bearerFromRequest(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if h == "" {
		return "", false
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		// Wrong scheme: signal "no bearer" so the cookie path can run. An
		// explicit bad scheme should not leak as a bearer-auth failure.
		return "", false
	}
	raw := strings.TrimSpace(h[len(prefix):])
	if raw == "" {
		return "", false
	}
	return raw, true
}

// Chain composes middleware left-to-right: Chain(f, g)(h) = f(g(h)).
func Chain(h http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}
