package auth

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/danpicton/crapnote/internal/httpx"
	"golang.org/x/crypto/bcrypt"
)

// AdminHandler holds HTTP handlers for admin user-management endpoints.
type AdminHandler struct {
	users *UserRepo
}

// NewAdminHandler creates a new AdminHandler.
func NewAdminHandler(users *UserRepo) *AdminHandler {
	return &AdminHandler{users: users}
}

// ListUsers handles GET /api/admin/users
func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r)
	users, err := h.users.List(r.Context(), page.Limit, page.Offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	out := make([]userResponse, 0, len(users))
	for _, u := range users {
		out = append(out, toUserResponse(u))
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out) //nolint:errcheck
}

// CreateUser handles POST /api/admin/users
// Body: { "username": "...", "password": "...", "is_admin": bool }
func (h *AdminHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		IsAdmin  bool   `json:"is_admin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Username == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password are required")
		return
	}
	if len(req.Password) < MinPasswordLen {
		writeError(w, http.StatusBadRequest, "password must be at least 12 characters")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	u, err := h.users.Create(r.Context(), req.Username, string(hash), req.IsAdmin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	actor := UserFromContext(r.Context())
	var actorID int64
	if actor != nil {
		actorID = actor.ID
	}
	slog.Info("audit: user created",
		"event", "user_created",
		"admin_id", actorID,
		"new_user_id", u.ID,
		"new_username", u.Username,
		"is_admin", u.IsAdmin,
		"ip", httpx.ClientIP(r),
	)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(toUserResponse(u)) //nolint:errcheck
}

// SetAPITokensEnabled handles PATCH /api/admin/users/{id}/api-tokens
// Body: { "enabled": bool }
//
// Toggles a user's ability to create API tokens. Disabling the flag does not
// automatically revoke a user's existing tokens in storage, but the auth
// middleware rejects them at request time, so access stops immediately.
// The caller may additionally invoke the user's own revoke-all flow if they
// want the tokens marked as revoked in the database.
func (h *AdminHandler) SetAPITokensEnabled(w http.ResponseWriter, r *http.Request) {
	caller := UserFromContext(r.Context())
	if caller == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.users.SetAPITokensEnabled(r.Context(), id, req.Enabled); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("audit: api tokens permission changed",
		"event", "user_api_tokens_toggled",
		"admin_id", caller.ID,
		"target_user_id", id,
		"enabled", req.Enabled,
		"ip", httpx.ClientIP(r),
	)

	u, err := h.users.FindByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(toUserResponse(u))
}

// MinPasswordLen is the minimum length enforced for passwords set via admin
// or self-service flows.
const MinPasswordLen = 12

// SetUserPassword handles PUT /api/admin/users/{id}/password
// Body: { "password": "..." }
//
// Replaces the user's stored hash with a bcrypt hash of the new password and
// clears any outstanding lock on the account (otherwise an admin resetting a
// locked user's password would leave them still locked, which is almost never
// what the admin wants).
func (h *AdminHandler) SetUserPassword(w http.ResponseWriter, r *http.Request) {
	caller := UserFromContext(r.Context())
	if caller == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
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

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := h.users.SetPassword(r.Context(), id, string(hash)); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Clear any lock — a password reset implies the admin wants the user to
	// regain access immediately. Ignore ErrNotFound (user just deleted).
	h.users.Unlock(r.Context(), id) //nolint:errcheck

	slog.Info("audit: admin password reset",
		"event", "admin_password_reset",
		"admin_id", caller.ID,
		"target_user_id", id,
		"ip", httpx.ClientIP(r),
	)

	w.WriteHeader(http.StatusNoContent)
}

// LockUser handles POST /api/admin/users/{id}/lock
// An admin cannot lock themselves.
func (h *AdminHandler) LockUser(w http.ResponseWriter, r *http.Request) {
	caller := UserFromContext(r.Context())
	if caller == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if id == caller.ID {
		writeError(w, http.StatusBadRequest, "cannot lock yourself")
		return
	}

	if err := h.users.Lock(r.Context(), id); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("audit: admin lock",
		"event", "admin_lock",
		"admin_id", caller.ID,
		"target_user_id", id,
		"ip", httpx.ClientIP(r),
	)

	u, err := h.users.FindByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(toUserResponse(u))
}

// UnlockUser handles POST /api/admin/users/{id}/unlock
// Clears the account lock and zeroes the failed-attempt counter.
func (h *AdminHandler) UnlockUser(w http.ResponseWriter, r *http.Request) {
	caller := UserFromContext(r.Context())
	if caller == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	if err := h.users.Unlock(r.Context(), id); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("audit: admin unlock",
		"event", "admin_unlock",
		"admin_id", caller.ID,
		"target_user_id", id,
		"ip", httpx.ClientIP(r),
	)

	u, err := h.users.FindByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(toUserResponse(u))
}

// DeleteUser handles DELETE /api/admin/users/{id}
// An admin cannot delete themselves.
func (h *AdminHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	caller := UserFromContext(r.Context())
	if caller == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	if id == caller.ID {
		writeError(w, http.StatusBadRequest, "cannot delete yourself")
		return
	}

	if err := h.users.Delete(r.Context(), id); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("audit: user deleted",
		"event", "user_deleted",
		"admin_id", caller.ID,
		"target_user_id", id,
		"ip", httpx.ClientIP(r),
	)

	w.WriteHeader(http.StatusNoContent)
}

type userResponse struct {
	ID               int64  `json:"id"`
	Username         string `json:"username"`
	IsAdmin          bool   `json:"is_admin"`
	APITokensEnabled bool   `json:"api_tokens_enabled"`
	Locked           bool   `json:"locked"`
	LockedAt         string `json:"locked_at,omitempty"`
	CreatedAt        string `json:"created_at"`
}

func toUserResponse(u *User) userResponse {
	resp := userResponse{
		ID:               u.ID,
		Username:         u.Username,
		IsAdmin:          u.IsAdmin,
		APITokensEnabled: u.APITokensEnabled,
		Locked:           u.LockedAt != nil,
		CreatedAt:        u.CreatedAt.Format("2006-01-02T15:04:05Z"),
	}
	if u.LockedAt != nil {
		resp.LockedAt = u.LockedAt.Format("2006-01-02T15:04:05Z")
	}
	return resp
}
