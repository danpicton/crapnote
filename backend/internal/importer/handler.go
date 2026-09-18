package importer

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/danpicton/crapnote/internal/auth"
)

// Handler serves the authenticated archive import endpoint.
type Handler struct {
	service        *Service
	maxUploadBytes int64
}

// NewHandler creates an import handler.
func NewHandler(service *Service) *Handler {
	return &Handler{service: service, maxUploadBytes: MaxUploadBytes}
}

// Import handles POST /api/import with multipart fields archive and password.
func (h *Handler) Import(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeImportError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	// Allow a small multipart envelope in addition to the compressed archive,
	// then enforce the archive's own size exactly while reading the file part.
	maxUploadBytes := h.maxUploadBytes
	if maxUploadBytes <= 0 {
		maxUploadBytes = MaxUploadBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeImportError(w, http.StatusBadRequest, "import upload is too large or malformed")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll() //nolint:errcheck
	}
	file, _, err := r.FormFile("archive")
	if err != nil {
		writeImportError(w, http.StatusBadRequest, "choose a Crapnote export ZIP to import")
		return
	}
	defer file.Close() //nolint:errcheck

	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		writeImportError(w, http.StatusBadRequest, "could not read the uploaded archive")
		return
	}
	if int64(len(data)) > maxUploadBytes {
		writeImportError(w, http.StatusRequestEntityTooLarge, "compressed archive exceeds the 100 MB limit")
		return
	}

	result, err := h.service.Import(r.Context(), user.ID, data, r.FormValue("password"))
	switch {
	case errors.Is(err, ErrQuota):
		writeImportError(w, http.StatusInsufficientStorage, err.Error())
		return
	case errors.Is(err, ErrInvalidArchive):
		message := strings.TrimPrefix(err.Error(), ErrInvalidArchive.Error()+": ")
		writeImportError(w, http.StatusBadRequest, message)
		return
	case err != nil:
		writeImportError(w, http.StatusInternalServerError, "import failed due to an internal error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(result)
}

func writeImportError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
