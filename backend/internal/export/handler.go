package export

import (
	"fmt"
	"net/http"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/notes"
)

// Handler handles the export endpoint.
type Handler struct {
	notes *notes.Service
}

// NewHandler creates a new export Handler.
func NewHandler(notesSvc *notes.Service) *Handler {
	return &Handler{notes: notesSvc}
}

// Export handles GET /api/export?password=<optional>
// Streams a ZIP file containing all non-trashed notes as .md files.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
		return
	}

	password := r.URL.Query().Get("password")

	noteList, err := h.notes.List(r.Context(), u.ID, notes.ListFilter{})
	if err != nil {
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	filename := fmt.Sprintf("crapnote-export-%s.zip",
		time.Now().UTC().Format("2006-01-02"))

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"`, filename))

	if err := Build(w, noteList, password); err != nil {
		// Headers already sent; log but can't return a clean error.
		_ = err
	}
}
