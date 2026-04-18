package notes

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/httpx"
)

const (
	maxTitleLen = 500
	maxBodyLen  = 500_000
)

// Handler holds HTTP handlers for notes endpoints.
type Handler struct {
	svc *Service
}

// NewHandler creates a new notes Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// List handles GET /api/notes
// Supports ?starred=true, ?tag=<id>, ?search=<query>
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	filter := ListFilter{}

	if s := r.URL.Query().Get("starred"); s != "" {
		starred := s == "true"
		filter.Starred = &starred
	}

	if tagStr := r.URL.Query().Get("tag"); tagStr != "" {
		tagID, err := strconv.ParseInt(tagStr, 10, 64)
		if err == nil {
			filter.TagID = &tagID
		}
	}

	filter.Search = r.URL.Query().Get("search")

	page := httpx.ParsePage(r)
	filter.Limit = page.Limit
	filter.Offset = page.Offset

	notes, err := h.svc.List(r.Context(), u.ID, filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, notesToResponse(notes))
}

// Create handles POST /api/notes
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var req struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Title) > maxTitleLen {
		writeError(w, http.StatusBadRequest, "title exceeds maximum length")
		return
	}
	if len(req.Body) > maxBodyLen {
		writeError(w, http.StatusBadRequest, "body exceeds maximum length")
		return
	}

	note, err := h.svc.Create(r.Context(), u.ID, req.Title, req.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, noteToResponse(note))
}

// Get handles GET /api/notes/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid note id")
		return
	}

	note, err := h.svc.Get(r.Context(), id, u.ID)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, noteToResponse(note))
}

// Update handles PUT /api/notes/{id}
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid note id")
		return
	}

	var req struct {
		Title *string `json:"title"`
		Body  *string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Title != nil && len(*req.Title) > maxTitleLen {
		writeError(w, http.StatusBadRequest, "title exceeds maximum length")
		return
	}
	if req.Body != nil && len(*req.Body) > maxBodyLen {
		writeError(w, http.StatusBadRequest, "body exceeds maximum length")
		return
	}

	note, err := h.svc.Update(r.Context(), id, u.ID, req.Title, req.Body)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, noteToResponse(note))
}

// Delete handles DELETE /api/notes/{id} — moves to trash
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid note id")
		return
	}

	if err := h.svc.Delete(r.Context(), id, u.ID); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ToggleStar handles PATCH /api/notes/{id}/star
func (h *Handler) ToggleStar(w http.ResponseWriter, r *http.Request) {
	h.toggleFlag(w, r, h.svc.ToggleStar)
}

// TogglePin handles PATCH /api/notes/{id}/pin
func (h *Handler) TogglePin(w http.ResponseWriter, r *http.Request) {
	h.toggleFlag(w, r, h.svc.TogglePin)
}

// Archive handles PATCH /api/notes/{id}/archive
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid note id")
		return
	}
	if err := h.svc.Archive(r.Context(), id, u.ID); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Unarchive handles PATCH /api/notes/{id}/unarchive
func (h *Handler) Unarchive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid note id")
		return
	}
	if err := h.svc.Unarchive(r.Context(), id, u.ID); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListArchived handles GET /api/archive
func (h *Handler) ListArchived(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	page := httpx.ParsePage(r)
	notes, err := h.svc.ListArchived(r.Context(), u.ID, page.Limit, page.Offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, notesToResponse(notes))
}

func (h *Handler) toggleFlag(
	w http.ResponseWriter,
	r *http.Request,
	fn func(ctx context.Context, id, userID int64) (*Note, error),
) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid note id")
		return
	}

	note, err := fn(r.Context(), id, u.ID)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "note not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, noteToResponse(note))
}

// ── helpers ──────────────────────────────────────────────────────────────────

func parseID(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

type noteResponse struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Starred   bool   `json:"starred"`
	Pinned    bool   `json:"pinned"`
	Archived  bool   `json:"archived"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

func noteToResponse(n *Note) noteResponse {
	return noteResponse{
		ID:        n.ID,
		Title:     n.Title,
		Body:      n.Body,
		Starred:   n.Starred,
		Pinned:    n.Pinned,
		Archived:  n.Archived,
		CreatedAt: n.CreatedAt.Format("2006-01-02T15:04:05Z"),
		UpdatedAt: n.UpdatedAt.Format("2006-01-02T15:04:05Z"),
	}
}

func notesToResponse(ns []*Note) []noteResponse {
	out := make([]noteResponse, 0, len(ns))
	for _, n := range ns {
		out = append(out, noteToResponse(n))
	}
	return out
}
