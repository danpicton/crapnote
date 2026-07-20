package settings

import (
	"encoding/json"
	"errors"
	"net/http"
)

// Handler holds HTTP handlers for the global-theme endpoints.
type Handler struct {
	svc *Service
}

// NewHandler creates a new settings Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetTheme handles GET /api/theme (public — the login screen needs it before
// any session exists). Responds {"theme":""} when no global theme is set.
func (h *Handler) GetTheme(w http.ResponseWriter, r *http.Request) {
	theme, err := h.svc.GlobalTheme(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"theme": theme})
}

// SetTheme handles PUT /api/admin/theme (admin only — enforced by middleware).
func (h *Handler) SetTheme(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Theme string `json:"theme"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := h.svc.SetGlobalTheme(r.Context(), req.Theme); errors.Is(err, ErrInvalidTheme) {
		writeError(w, http.StatusBadRequest, "invalid theme id")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
