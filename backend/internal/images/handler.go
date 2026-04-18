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
	"github.com/danpicton/crapnote/internal/ratelimit"
)

const maxImageSize = 10 << 20 // 10 MB

// Config controls per-user upload throttling and storage quota. See issue #15.
type Config struct {
	// UploadsPerMinute caps how often a single user may upload.
	UploadsPerMinute int
	// QuotaBytes is the maximum cumulative image storage per user. A new
	// upload is rejected if it would push the user over this limit.
	QuotaBytes int64
}

// DefaultConfig returns the production upload throttling settings.
func DefaultConfig() Config {
	return Config{
		UploadsPerMinute: 10,
		QuotaBytes:       100 << 20, // 100 MB per user
	}
}

// allowedImageMIMEs enumerates accepted image MIME types. Anything else is
// rejected so attackers cannot smuggle arbitrary binaries through the upload
// endpoint.
var allowedImageMIMEs = map[string]struct{}{
	"image/jpeg": {},
	"image/png":  {},
	"image/gif":  {},
	"image/webp": {},
}

func isAllowedImage(mime string) bool {
	_, ok := allowedImageMIMEs[mime]
	return ok
}

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
	db         *sql.DB
	limiter    *ratelimit.Limiter
	quotaBytes int64
}

// NewHandler creates a new images Handler with production defaults.
func NewHandler(db *sql.DB) *Handler {
	return NewHandlerWith(db, DefaultConfig())
}

// NewHandlerWith creates a new images Handler with custom upload limits.
func NewHandlerWith(db *sql.DB, cfg Config) *Handler {
	if cfg.UploadsPerMinute <= 0 {
		cfg.UploadsPerMinute = DefaultConfig().UploadsPerMinute
	}
	if cfg.QuotaBytes <= 0 {
		cfg.QuotaBytes = DefaultConfig().QuotaBytes
	}
	return &Handler{
		db: db,
		limiter: ratelimit.New(
			float64(cfg.UploadsPerMinute)/60.0,
			cfg.UploadsPerMinute,
		),
		quotaBytes: cfg.QuotaBytes,
	}
}

// Upload handles POST /api/images (multipart form with field "image").
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	// Per-user rate limit — protects against a single account being used to
	// fill storage by rapid successive uploads.
	if !h.limiter.Allow(fmt.Sprintf("u:%d", u.ID)) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "upload rate limit exceeded")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxImageSize+512)
	if err := r.ParseMultipartForm(maxImageSize); err != nil {
		writeError(w, http.StatusBadRequest, "image too large or bad request")
		return
	}

	file, _, err := r.FormFile("image")
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

	// Reject anything that does not sniff as one of the allowed image types.
	// Trusting the client-supplied Content-Type would let attackers store
	// arbitrary payloads in the images table.
	mimeType := http.DetectContentType(data)
	if !isAllowedImage(mimeType) {
		writeError(w, http.StatusUnsupportedMediaType, "not an image")
		return
	}

	// Per-user storage quota: reject the upload if it would exceed the cap.
	used, err := currentImageBytes(r.Context(), h.db, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if used+int64(len(data)) > h.quotaBytes {
		writeError(w, http.StatusInsufficientStorage, "storage quota exceeded")
		return
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

// currentImageBytes returns the total bytes of images currently owned by
// userID. Used to enforce a per-user storage quota.
func currentImageBytes(ctx context.Context, db *sql.DB, userID int64) (int64, error) {
	var total sql.NullInt64
	err := db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(LENGTH(data)), 0) FROM images WHERE user_id = ?`, userID,
	).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total.Int64, nil
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
