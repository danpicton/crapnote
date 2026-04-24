package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/danpicton/crapnote/internal/httpx"
	"golang.org/x/crypto/bcrypt"
)

// AdminHandler holds HTTP handlers for admin user-management endpoints.
type AdminHandler struct {
	users *UserRepo
	svc   *Service // optional — required for invite endpoints
}

// NewAdminHandler creates a new AdminHandler for the admin CRUD endpoints.
// Invite-based endpoints are unavailable; use NewAdminHandlerWithInvites.
func NewAdminHandler(users *UserRepo) *AdminHandler {
	return &AdminHandler{users: users}
}

// NewAdminHandlerWithInvites creates a new AdminHandler with access to the
// auth Service, enabling the invite endpoints.
func NewAdminHandlerWithInvites(users *UserRepo, svc *Service) *AdminHandler {
	return &AdminHandler{users: users, svc: svc}
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
		out = append(out, h.toUserResponseWithSetup(r.Context(), u))
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

// InviteTTL is the lifetime of a setup-token invite link.
const InviteTTL = 7 * 24 * time.Hour

// InviteUser handles POST /api/admin/users/invite
// Body: { "username": "...", "is_admin": bool }
//
// Creates a user with an unusable random password_hash and generates a
// single-use setup token. The response includes a full setup URL that the
// admin can share out-of-band with the new user. The user sets their real
// password via that link and is then able to log in.
func (h *AdminHandler) InviteUser(w http.ResponseWriter, r *http.Request) {
	caller := UserFromContext(r.Context())
	if caller == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if h.svc == nil {
		writeError(w, http.StatusInternalServerError, "invite flow not configured")
		return
	}

	var req struct {
		Username string `json:"username"`
		IsAdmin  bool   `json:"is_admin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Username == "" {
		writeError(w, http.StatusBadRequest, "username is required")
		return
	}

	// Seed an unusable password hash — the bcrypt output for 32 random bytes
	// cannot be re-derived without the bytes themselves, so login is
	// impossible until CompleteSetup replaces the hash.
	seed := make([]byte, 32)
	if _, err := rand.Read(seed); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(hex.EncodeToString(seed)), bcryptCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	u, err := h.users.Create(r.Context(), req.Username, string(hash), req.IsAdmin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	rawToken, _, err := h.svc.CreateInvite(r.Context(), u.ID, InviteTTL)
	if err != nil {
		// If invite creation failed, drop the half-created user so the admin
		// can retry without a stale zombie row.
		h.users.Delete(r.Context(), u.ID) //nolint:errcheck
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	setupURL := buildSetupURL(r, rawToken)

	slog.Info("audit: user invited",
		"event", "user_invited",
		"admin_id", caller.ID,
		"new_user_id", u.ID,
		"new_username", u.Username,
		"is_admin", u.IsAdmin,
		"ip", httpx.ClientIP(r),
	)

	resp := map[string]any{
		"user":       h.toUserResponseWithSetup(r.Context(), u),
		"setup_url":  setupURL,
		"expires_at": time.Now().Add(InviteTTL).UTC().Format("2006-01-02T15:04:05Z"),
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(resp)
}

// buildSetupURL returns a fully-qualified setup URL relative to the current
// request's host. The scheme follows the effective transport so links work
// both over HTTPS and plain HTTP deployments.
func buildSetupURL(r *http.Request, rawToken string) string {
	scheme := "https"
	if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") != "https" {
		scheme = "http"
	}
	host := r.Host
	if host == "" {
		host = "localhost"
	}
	return scheme + "://" + host + "/setup/" + rawToken
}

// RegenerateInvite handles POST /api/admin/users/{id}/invite
//
// Issues a new setup-token for an existing user, invalidating any previous
// invite. Useful when a previous link was lost or when the admin wants to
// force a password reset without knowing the new password.
func (h *AdminHandler) RegenerateInvite(w http.ResponseWriter, r *http.Request) {
	caller := UserFromContext(r.Context())
	if caller == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	if h.svc == nil {
		writeError(w, http.StatusInternalServerError, "invite flow not configured")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	u, err := h.users.FindByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	rawToken, _, err := h.svc.CreateInvite(r.Context(), u.ID, InviteTTL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	setupURL := buildSetupURL(r, rawToken)

	slog.Info("audit: invite regenerated",
		"event", "invite_regenerated",
		"admin_id", caller.ID,
		"target_user_id", id,
		"ip", httpx.ClientIP(r),
	)

	resp := map[string]any{
		"user":       h.toUserResponseWithSetup(r.Context(), u),
		"setup_url":  setupURL,
		"expires_at": time.Now().Add(InviteTTL).UTC().Format("2006-01-02T15:04:05Z"),
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
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
	PendingSetup     bool   `json:"pending_setup"`
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

func (h *AdminHandler) toUserResponseWithSetup(ctx context.Context, u *User) userResponse {
	resp := toUserResponse(u)
	if h.svc != nil {
		if has, err := h.svc.HasActiveInvite(ctx, u.ID); err == nil {
			resp.PendingSetup = has
		}
	}
	return resp
}
