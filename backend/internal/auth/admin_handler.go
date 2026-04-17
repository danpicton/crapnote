package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

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
	users, err := h.users.List(r.Context())
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
	const minPasswordLen = 12
	if req.Username == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "username and password are required")
		return
	}
	if len(req.Password) < minPasswordLen {
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

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(toUserResponse(u)) //nolint:errcheck
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

	w.WriteHeader(http.StatusNoContent)
}

type userResponse struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	IsAdmin   bool   `json:"is_admin"`
	CreatedAt string `json:"created_at"`
}

func toUserResponse(u *User) userResponse {
	return userResponse{
		ID:        u.ID,
		Username:  u.Username,
		IsAdmin:   u.IsAdmin,
		CreatedAt: u.CreatedAt.Format("2006-01-02T15:04:05Z"),
	}
}
