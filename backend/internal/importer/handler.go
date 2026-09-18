package importer

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
)

// Bound aggregate upload/parsing memory and temporary disk use across accounts
// and handler instances. Admission happens before reading any request bytes.
var importSlot = make(chan struct{}, 1)

// MaxUploadDuration is an absolute upload deadline, not a resettable idle timer.
// A client must send the entire multipart body within this window.
const MaxUploadDuration = 2 * time.Minute

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

	select {
	case importSlot <- struct{}{}:
		defer func() { <-importSlot }()
	default:
		w.Header().Set("Connection", "close") // do not drain a rejected stalled body
		w.Header().Set("Retry-After", "5")
		writeImportError(w, http.StatusServiceUnavailable, "another import is in progress; try again shortly")
		return
	}

	// A context timeout alone cannot interrupt a blocked socket Read. Set the
	// actual HTTP connection/stream deadline before reading multipart bytes.
	// Fail closed if a ResponseWriter wrapper hides deadline support.
	controller := http.NewResponseController(w)
	w.Header().Set("Connection", "close") // failed uploads must not be drained indefinitely
	if err := controller.SetReadDeadline(time.Now().Add(MaxUploadDuration)); err != nil {
		writeImportError(w, http.StatusInternalServerError, "import upload deadlines are unavailable; contact the administrator")
		return
	}

	// Allow a small multipart envelope in addition to the compressed archive,
	// then enforce the archive's own size exactly while reading the file part.
	maxUploadBytes := h.maxUploadBytes
	if maxUploadBytes <= 0 {
		maxUploadBytes = MaxUploadBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+(1<<20))
	multipart, err := r.MultipartReader()
	if err != nil {
		writeImportError(w, http.StatusBadRequest, "import upload is too large or malformed")
		return
	}
	file, err := os.CreateTemp("", "crapnote-import-*.zip")
	if err != nil {
		writeImportError(w, http.StatusInternalServerError, "could not stage the import; try again later")
		return
	}
	defer os.Remove(file.Name()) //nolint:errcheck
	defer file.Close()           //nolint:errcheck

	var size int64
	var password string
	seen := make(map[string]bool)
	for {
		part, err := multipart.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeUploadReadError(w, err, "import upload is too large or malformed")
			return
		}
		name := part.FormName()
		if seen[name] || name != "archive" && name != "password" {
			writeImportError(w, http.StatusBadRequest, "send one archive and an optional password")
			return
		}
		seen[name] = true
		if name == "archive" {
			// Stream compressed bytes straight to a private temporary file. ZIP
			// needs ReaderAt, not a second in-memory copy of the upload.
			size, err = io.Copy(file, io.LimitReader(part, maxUploadBytes+1))
			if size > maxUploadBytes {
				writeImportError(w, http.StatusRequestEntityTooLarge, "compressed archive exceeds the 100 MB limit")
				return
			}
		} else {
			var value []byte
			value, err = io.ReadAll(io.LimitReader(part, (64<<10)+1))
			if len(value) > 64<<10 {
				writeImportError(w, http.StatusBadRequest, "export password exceeds the 64 KB limit")
				return
			}
			password = string(value)
		}
		if err != nil {
			writeUploadReadError(w, err, "could not read or stage the uploaded archive; try again")
			return
		}
	}
	if !seen["archive"] {
		writeImportError(w, http.StatusBadRequest, "choose a Crapnote export ZIP to import")
		return
	}

	// Multipart EOF only marks the last boundary. Drain any HTTP epilogue or
	// trailers under the SAME deadline; otherwise net/http could block draining
	// them while writing our response after the deadline has been cleared.
	if _, err := io.Copy(io.Discard, r.Body); err != nil {
		writeUploadReadError(w, err, "import upload is too large or malformed")
		return
	}

	// All request bytes have arrived. Clear the read deadline before storage
	// work and keep-alive reuse; no timer goroutine or blocked body reader is left.
	if err := controller.SetReadDeadline(time.Time{}); err != nil {
		writeImportError(w, http.StatusInternalServerError, "could not finish the upload; try again")
		return
	}
	w.Header().Del("Connection")

	result, err := h.service.ImportReader(r.Context(), user.ID, file, size, password)
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

func writeUploadReadError(w http.ResponseWriter, err error, message string) {
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		writeImportError(w, http.StatusRequestTimeout, "import upload timed out; send the complete ZIP within 2 minutes and try again")
		return
	}
	writeImportError(w, http.StatusBadRequest, message)
}

func writeImportError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
