package export

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/notes"
)

// Handler handles the export endpoint.
type Handler struct {
	notes *notes.Service
	db    *sql.DB
}

// NewHandler creates a new export Handler.
func NewHandler(notesSvc *notes.Service, db *sql.DB) *Handler {
	return &Handler{notes: notesSvc, db: db}
}

// Export handles POST /api/export
// Streams a ZIP file containing all non-trashed notes as .md files,
// with any referenced images bundled under images/ and src paths rewritten.
// An optional password in the JSON body encrypts the ZIP.
func (h *Handler) Export(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		http.Error(w, `{"error":"not authenticated"}`, http.StatusUnauthorized)
		return
	}

	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	password := body.Password

	noteList, err := h.notes.List(r.Context(), u.ID, notes.ListFilter{})
	if err != nil {
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	// Collect every image ID referenced across all notes.
	var allIDs []string
	seen := make(map[string]struct{})
	for _, n := range noteList {
		for _, id := range extractImageIDs(n.Body) {
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				allIDs = append(allIDs, id)
			}
		}
	}

	imageData, err := images.FetchByIDs(r.Context(), h.db, u.ID, allIDs)
	if err != nil {
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	filename := fmt.Sprintf("crapnote-export-%s.zip",
		time.Now().UTC().Format("2006-01-02"))

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"`, filename))

	if err := Build(w, noteList, imageData, password); err != nil {
		// Headers already sent; can't return a clean HTTP error.
		_ = err
	}
}
