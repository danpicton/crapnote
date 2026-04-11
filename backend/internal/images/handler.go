package images

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/danpicton/crapnote/internal/auth"
)

const maxImageSize = 10 << 20 // 10 MB

// Data holds the raw bytes and MIME type of a stored image.
type Data struct {
	MimeType string
	Bytes    []byte
}

// FetchByIDs returns the image data for the given IDs that belong to userID.
// IDs not found or belonging to another user are silently omitted.
func FetchByIDs(ctx context.Context, db *sql.DB, userID int64, ids []string) (map[string]Data, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	out := make(map[string]Data, len(ids))
	for _, id := range ids {
		var uid int64
		var mime string
		var data []byte
		err := db.QueryRowContext(ctx,
			`SELECT user_id, mime_type, data FROM images WHERE id = ?`, id,
		).Scan(&uid, &mime, &data)
		if err == sql.ErrNoRows || uid != userID {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("fetch image %s: %w", id, err)
		}
		out[id] = Data{MimeType: mime, Bytes: data}
	}
	return out, nil
}

// Handler holds HTTP handlers for image upload and serving.
type Handler struct {
	db *sql.DB
}

// NewHandler creates a new images Handler.
func NewHandler(db *sql.DB) *Handler {
	return &Handler{db: db}
}

// Upload handles POST /api/images (multipart form with field "image").
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxImageSize+512)
	if err := r.ParseMultipartForm(maxImageSize); err != nil {
		writeError(w, http.StatusBadRequest, "image too large or bad request")
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing image field")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxImageSize))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}

	id := newID()

	_, err = h.db.ExecContext(r.Context(),
		`INSERT INTO images (id, user_id, mime_type, data) VALUES (?, ?, ?, ?)`,
		id, u.ID, mimeType, data,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"url": "/api/images/" + id}) //nolint:errcheck
}

// Serve handles GET /api/images/{id}.
func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	id := r.PathValue("id")

	var userID int64
	var mimeType string
	var data []byte

	err := h.db.QueryRowContext(r.Context(),
		`SELECT user_id, mime_type, data FROM images WHERE id = ?`, id,
	).Scan(&userID, &mimeType, &data)

	if err == sql.ErrNoRows {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Users can only access their own images.
	if userID != u.ID {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Write(data) //nolint:errcheck
}

// ── helpers ───────────────────────────────────────────────────────────────────

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("images: rand.Read: %v", err))
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg}) //nolint:errcheck
}
