package auth

import (
	"context"
	"errors"
	"net/http"
)

type contextKey string

const userContextKey contextKey = "auth_user"

// WithUser returns a new context carrying the authenticated user.
func WithUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, userContextKey, u)
}

// UserFromContext retrieves the authenticated user from context, or nil.
func UserFromContext(ctx context.Context) *User {
	u, _ := ctx.Value(userContextKey).(*User)
	return u
}

// RequireAuth is middleware that validates the session cookie and injects the
// user into the request context. Returns 401 if missing/invalid.
func (h *Handler) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

		next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), user)))
	})
}

// RequireAdmin is middleware that enforces admin access after RequireAuth.
// Must be chained after RequireAuth.
func (h *Handler) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromContext(r.Context())
		if u == nil || !u.IsAdmin {
			writeError(w, http.StatusForbidden, "admin access required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Chain composes middleware left-to-right: Chain(f, g)(h) = f(g(h)).
func Chain(h http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}
