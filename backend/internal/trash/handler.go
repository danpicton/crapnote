package trash

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/danpicton/crapnote/internal/auth"
)

// Handler holds HTTP handlers for trash endpoints.
type Handler struct {
	svc *Service
}

// NewHandler creates a new trash Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// List handles GET /api/trash
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	entries, err := h.svc.List(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	out := make([]entryResponse, 0, len(entries))
	for _, e := range entries {
		out = append(out, toResponse(e))
	}
	writeJSON(w, http.StatusOK, out)
}

// Restore handles POST /api/trash/{id}/restore
func (h *Handler) Restore(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	noteID, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	if err := h.svc.Restore(r.Context(), noteID, u.ID); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not found in trash")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteOne handles DELETE /api/trash/{id}
func (h *Handler) DeleteOne(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	noteID, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	if err := h.svc.DeleteOne(r.Context(), noteID, u.ID); errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not found in trash")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Empty handles DELETE /api/trash
func (h *Handler) Empty(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	if err := h.svc.Empty(r.Context(), u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

type entryResponse struct {
	NoteID            int64  `json:"note_id"`
	Title             string `json:"title"`
	DeletedAt         string `json:"deleted_at"`
	PermanentDeleteAt string `json:"permanent_delete_at"`
}

func toResponse(e *Entry) entryResponse {
	return entryResponse{
		NoteID:            e.NoteID,
		Title:             e.Title,
		DeletedAt:         e.DeletedAt.Format("2006-01-02T15:04:05Z"),
		PermanentDeleteAt: e.PermanentDeleteAt.Format("2006-01-02T15:04:05Z"),
	}
}
