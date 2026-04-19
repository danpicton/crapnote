package tokens

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/httpx"
)

// Handler serves HTTP endpoints for managing a user's own API tokens.
type Handler struct {
	svc *Service
}

// NewHandler creates a new token Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// tokenResponse is the shape returned to clients for a stored token. The raw
// secret is never included here.
type tokenResponse struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Prefix     string  `json:"prefix"`
	Scope      string  `json:"scope"`
	LastUsedAt *string `json:"last_used_at,omitempty"`
	ExpiresAt  *string `json:"expires_at,omitempty"`
	RevokedAt  *string `json:"revoked_at,omitempty"`
	CreatedAt  string  `json:"created_at"`
}

func toTokenResponse(t *Token) tokenResponse {
	fmt := "2006-01-02T15:04:05Z"
	out := tokenResponse{
		ID:        t.ID,
		Name:      t.Name,
		Prefix:    t.Prefix,
		Scope:     string(t.Scope),
		CreatedAt: t.CreatedAt.UTC().Format(fmt),
	}
	if t.LastUsedAt != nil {
		s := t.LastUsedAt.UTC().Format(fmt)
		out.LastUsedAt = &s
	}
	if t.ExpiresAt != nil {
		s := t.ExpiresAt.UTC().Format(fmt)
		out.ExpiresAt = &s
	}
	if t.RevokedAt != nil {
		s := t.RevokedAt.UTC().Format(fmt)
		out.RevokedAt = &s
	}
	return out
}

// List handles GET /api/tokens — returns the caller's tokens (no raw secrets).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	list, err := h.svc.List(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	out := make([]tokenResponse, 0, len(list))
	for _, t := range list {
		out = append(out, toTokenResponse(t))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

// Create handles POST /api/tokens.
// Body: { "name": "...", "scope": "read"|"read_write", "ttl_days": int? }
// ttl_days > 0: that many days. 0 or omitted: default (90 days). -1: no expiry.
// The response includes the raw token exactly once.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req struct {
		Name    string `json:"name"`
		Scope   string `json:"scope"`
		TTLDays int    `json:"ttl_days"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var ttl time.Duration
	switch {
	case req.TTLDays == 0:
		ttl = 0 // default
	case req.TTLDays < 0:
		ttl = -1 // no expiry
	default:
		ttl = time.Duration(req.TTLDays) * 24 * time.Hour
	}

	created, err := h.svc.Create(r.Context(), u, req.Name, Scope(req.Scope), ttl)
	switch {
	case errors.Is(err, ErrForbidden):
		writeError(w, http.StatusForbidden, "api tokens not permitted for this user")
		return
	case errors.Is(err, ErrInvalidName):
		writeError(w, http.StatusBadRequest, "invalid token name")
		return
	case errors.Is(err, ErrInvalidScope):
		writeError(w, http.StatusBadRequest, "invalid scope (want read or read_write)")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("audit: api token created",
		"event", "api_token_created",
		"user_id", u.ID,
		"token_id", created.Token.ID,
		"scope", string(created.Token.Scope),
		"ip", httpx.ClientIP(r),
	)

	resp := struct {
		tokenResponse
		Token string `json:"token"`
	}{
		tokenResponse: toTokenResponse(created.Token),
		Token:         created.RawToken,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(resp)
}

// Revoke handles DELETE /api/tokens/{id}.
func (h *Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid token id")
		return
	}
	if err := h.svc.Revoke(r.Context(), u.ID, id); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "token not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("audit: api token revoked",
		"event", "api_token_revoked",
		"user_id", u.ID,
		"token_id", id,
		"ip", httpx.ClientIP(r),
	)

	w.WriteHeader(http.StatusNoContent)
}

// RevokeAll handles POST /api/tokens/revoke-all — revokes every active token
// belonging to the caller.
func (h *Handler) RevokeAll(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if err := h.svc.RevokeAll(r.Context(), u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	slog.Info("audit: api tokens revoked (bulk)",
		"event", "api_tokens_revoked_all",
		"user_id", u.ID,
		"ip", httpx.ClientIP(r),
	)
	w.WriteHeader(http.StatusNoContent)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
