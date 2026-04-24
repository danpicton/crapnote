package auth

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/danpicton/crapnote/internal/httpx"
)

// SetupHandler holds the public HTTP handlers that consume one-time setup
// tokens. These endpoints require no authentication — the token is the sole
// credential.
type SetupHandler struct {
	svc *Service
}

// NewSetupHandler creates a new SetupHandler backed by an auth Service that
// has invites configured.
func NewSetupHandler(svc *Service) *SetupHandler {
	return &SetupHandler{svc: svc}
}

// Get handles GET /api/setup/{token}. Returns the username and expiry of the
// associated invite, or 404 if the token is unknown or expired. The 404 is
// deliberately unconditional — we never reveal whether a token ever existed.
func (h *SetupHandler) Get(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if token == "" {
		writeError(w, http.StatusNotFound, "setup link invalid or expired")
		return
	}

	hash := hashInviteToken(token)
	inv, err := h.svc.invites.FindByTokenHash(r.Context(), hash)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "setup link invalid or expired")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if inv.ExpiresAt.Before(time.Now().UTC()) {
		// Opportunistic cleanup.
		h.svc.invites.Delete(r.Context(), inv.ID) //nolint:errcheck
		writeError(w, http.StatusNotFound, "setup link invalid or expired")
		return
	}

	user, err := h.svc.users.FindByID(r.Context(), inv.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"username":   user.Username,
		"expires_at": inv.ExpiresAt.Format("2006-01-02T15:04:05Z"),
	})
}

// Complete handles POST /api/setup/{token}
// Body: { "password": "..." }
//
// Consumes the token, sets the user's password, and clears any lock. On
// success returns 204; the user must then navigate to /login to sign in.
func (h *SetupHandler) Complete(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Password) < MinPasswordLen {
		writeError(w, http.StatusBadRequest, "password must be at least 12 characters")
		return
	}

	u, err := h.svc.CompleteSetup(r.Context(), token, req.Password)
	if errors.Is(err, ErrInviteInvalid) {
		writeError(w, http.StatusNotFound, "setup link invalid or expired")
		return
	}
	if err != nil {
		slog.Error("audit: setup error",
			"event", "setup_error",
			"ip", httpx.ClientIP(r),
			"error", err,
		)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("audit: setup completed",
		"event", "setup_completed",
		"user_id", u.ID,
		"username", u.Username,
		"ip", httpx.ClientIP(r),
	)

	w.WriteHeader(http.StatusNoContent)
}
