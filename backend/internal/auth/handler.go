package auth

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/danpicton/crapnote/internal/httpx"
)

// Handler holds HTTP handlers for auth endpoints.
type Handler struct {
	svc    *Service
	bearer BearerAuthenticator
}

// NewHandler creates a new auth Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// isHTTPS reports whether the request arrived over HTTPS — either directly
// (r.TLS != nil) or via a reverse proxy that signals it with X-Forwarded-Proto.
// This is used to set the Secure flag on cookies: hardcoding Secure:true breaks
// plain-HTTP deployments because browsers silently discard secure cookies sent
// over HTTP, making every session immediately invalid after login.
func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

// Login handles POST /api/auth/login.
// Body: {"username": "...", "password": "..."}
// Sets an HttpOnly session cookie on success.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	sess, err := h.svc.Login(r.Context(), req.Username, req.Password)
	if errors.Is(err, ErrInvalidCredentials) {
		slog.Warn("audit: login failed",
			"event", "login_failed",
			"username", req.Username,
			"ip", httpx.ClientIP(r),
		)
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if errors.Is(err, ErrAccountLocked) {
		slog.Warn("audit: login blocked — account locked",
			"event", "login_locked",
			"username", req.Username,
			"ip", httpx.ClientIP(r),
		)
		writeError(w, http.StatusForbidden, "account locked")
		return
	}
	if err != nil {
		slog.Error("audit: login error",
			"event", "login_error",
			"username", req.Username,
			"ip", httpx.ClientIP(r),
			"error", err,
		)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("audit: login",
		"event", "login_succeeded",
		"user_id", sess.UserID,
		"ip", httpx.ClientIP(r),
	)

	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    sess.ID,
		Path:     "/",
		Expires:  sess.ExpiresAt,
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"}) //nolint:errcheck
}

// Logout handles POST /api/auth/logout.
// Deletes the session from the database and clears the cookie.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("session")
	if err == nil {
		h.svc.Logout(r.Context(), cookie.Value) //nolint:errcheck
		if u := UserFromContext(r.Context()); u != nil {
			slog.Info("audit: logout",
				"event", "logout",
				"user_id", u.ID,
				"ip", httpx.ClientIP(r),
			)
		}
	}

	// Clear the cookie regardless.
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})

	w.WriteHeader(http.StatusNoContent)
}

// ChangePassword handles POST /api/auth/password.
// Body: { "current_password": "...", "new_password": "..." }
// Any authenticated user (cookie or bearer) can change their own password
// by supplying their current password.
func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	u := UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.NewPassword) < MinPasswordLen {
		writeError(w, http.StatusBadRequest, "password must be at least 12 characters")
		return
	}

	err := h.svc.ChangePassword(r.Context(), u.ID, req.CurrentPassword, req.NewPassword)
	if errors.Is(err, ErrInvalidCredentials) {
		slog.Warn("audit: password change rejected — wrong current password",
			"event", "password_change_denied",
			"user_id", u.ID,
			"ip", httpx.ClientIP(r),
		)
		writeError(w, http.StatusForbidden, "current password is incorrect")
		return
	}
	if err != nil {
		slog.Error("audit: password change error",
			"event", "password_change_error",
			"user_id", u.ID,
			"error", err,
		)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("audit: password changed",
		"event", "password_changed",
		"user_id", u.ID,
		"ip", httpx.ClientIP(r),
	)
	w.WriteHeader(http.StatusNoContent)
}

// Me handles GET /api/auth/me.
// Returns the current user's info; requires the user to be in context.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	u := UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
		"id":                 u.ID,
		"username":           u.Username,
		"is_admin":           u.IsAdmin,
		"api_tokens_enabled": u.APITokensEnabled,
		"created_at":         u.CreatedAt,
	})
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg}) //nolint:errcheck
}
