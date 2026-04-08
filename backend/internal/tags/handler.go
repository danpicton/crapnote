package tags

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/danpicton/crapnote/internal/auth"
)

// Handler holds HTTP handlers for tag endpoints.
type Handler struct {
	svc *Service
}

// NewHandler creates a new tags Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// List handles GET /api/tags
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

	out := make([]tagResponse, 0, len(list))
	for _, t := range list {
		out = append(out, tagWithCountToResponse(t))
	}
	writeJSON(w, http.StatusOK, out)
}

// Create handles POST /api/tags
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	tag, err := h.svc.Create(r.Context(), u.ID, req.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusCreated, tagToResponse(tag))
}

// Rename handles PUT /api/tags/{id}
func (h *Handler) Rename(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id, err := parseID(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid tag id")
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	tag, err := h.svc.Rename(r.Context(), id, u.ID, req.Name)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "tag not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, tagToResponse(tag))
}

// Delete handles DELETE /api/tags/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id, err := parseID(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid tag id")
		return
	}

	if err := h.svc.Delete(r.Context(), id, u.ID); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "tag not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetForNote handles GET /api/notes/{id}/tags
func (h *Handler) GetForNote(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	noteID, err := parseID(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid note id")
		return
	}
	list, err := h.svc.ListForNote(r.Context(), noteID, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	out := make([]tagResponse, 0, len(list))
	for _, t := range list {
		out = append(out, tagToResponse(t))
	}
	writeJSON(w, http.StatusOK, out)
}

// AddToNote handles POST /api/notes/{id}/tags
func (h *Handler) AddToNote(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	noteID, err := parseID(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid note id")
		return
	}

	var req struct {
		TagID int64 `json:"tag_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.svc.AddToNote(r.Context(), noteID, req.TagID, u.ID); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "note or tag not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RemoveFromNote handles DELETE /api/notes/{id}/tags/{tid}
func (h *Handler) RemoveFromNote(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	noteID, err := parseID(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid note id")
		return
	}
	tagID, err := parseID(r, "tid")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid tag id")
		return
	}

	if err := h.svc.RemoveFromNote(r.Context(), noteID, tagID, u.ID); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── helpers ──────────────────────────────────────────────────────────────────

func parseID(r *http.Request, key string) (int64, error) {
	return strconv.ParseInt(r.PathValue(key), 10, 64)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

type tagResponse struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	Name      string `json:"name"`
	NoteCount int    `json:"note_count,omitempty"`
	CreatedAt string `json:"created_at"`
}

func tagToResponse(t *Tag) tagResponse {
	return tagResponse{
		ID:        t.ID,
		UserID:    t.UserID,
		Name:      t.Name,
		CreatedAt: t.CreatedAt.Format("2006-01-02T15:04:05Z"),
	}
}

func tagWithCountToResponse(t *TagWithCount) tagResponse {
	r := tagToResponse(&t.Tag)
	r.NoteCount = t.NoteCount
	return r
}
