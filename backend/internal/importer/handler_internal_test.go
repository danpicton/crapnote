package importer

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
)

// Block one authenticated upload before its first byte. Other handlers must
// reject concurrent imports without reading their bodies or allocating a ZIP.
func TestHandler_ProcessWideAdmissionBeforeReadingBody(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	body := &blockedBody{started: started, release: release}
	req := httptest.NewRequest(http.MethodPost, "/api/import", body)
	req.Header.Set("Content-Type", "multipart/form-data; boundary=test")
	req = req.WithContext(auth.WithUser(req.Context(), &auth.User{ID: 1}))
	done := make(chan struct{})
	go func() {
		defer close(done)
		NewHandler(nil).Import(newImportRecorder(), req)
	}()
	<-started
	defer func() { close(release); <-done }()

	secondBody := &observedBody{Reader: bytes.NewReader(nil)}
	second := httptest.NewRequest(http.MethodPost, "/api/import", secondBody)
	second.Header.Set("Content-Type", "multipart/form-data; boundary=test")
	second = second.WithContext(auth.WithUser(second.Context(), &auth.User{ID: 2}))
	response := httptest.NewRecorder()
	NewHandler(nil).Import(response, second)
	if response.Code != http.StatusServiceUnavailable || response.Header().Get("Retry-After") == "" {
		t.Errorf("busy status = %d, headers = %v", response.Code, response.Header())
	}
	if secondBody.read {
		t.Error("busy importer read the second upload")
	}
	if response.Header().Get("Connection") != "close" {
		t.Error("busy response must not let net/http drain a stalled rejected upload")
	}
}

type blockedBody struct {
	started, release chan struct{}
	once             sync.Once
}

func (b *blockedBody) Read([]byte) (int, error) {
	b.once.Do(func() { close(b.started) })
	<-b.release
	return 0, io.EOF
}

type observedBody struct {
	*bytes.Reader
	read bool
}

func (b *observedBody) Read(p []byte) (int, error) {
	b.read = true
	return b.Reader.Read(p)
}

func TestHandler_EnforcesCompressedArchiveLimit(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("archive", "backup.zip")
	if err != nil {
		t.Fatalf("create archive field: %v", err)
	}
	_, _ = part.Write([]byte("too large"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/import", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req = req.WithContext(auth.WithUser(req.Context(), &auth.User{ID: 1}))
	response := newImportRecorder()
	(&Handler{maxUploadBytes: 1}).Import(response, req)

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
}

func TestHandler_SpoolsUploadToDiskAndCleansUpOnFailure(t *testing.T) {
	directory := t.TempDir()
	t.Setenv("TMPDIR", directory)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("archive", "backup.zip")
	_, _ = part.Write(bytes.Repeat([]byte("x"), 2<<20))
	_ = writer.Close()
	observed := &diskObservedBody{Reader: bytes.NewReader(body.Bytes()), directory: directory}
	req := httptest.NewRequest(http.MethodPost, "/api/import", observed)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req = req.WithContext(auth.WithUser(req.Context(), &auth.User{ID: 1}))
	response := newImportRecorder()
	NewHandler(NewService(nil, DefaultConfig())).Import(response, req)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", response.Code)
	}
	if !observed.spooled {
		t.Error("upload was retained in memory rather than spooled while reading")
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 0 {
		t.Fatalf("temporary files after failed import: %v, %v", entries, err)
	}
}

// Direct unit tests have no socket; the external handler suite checks deadlines
// against a real httptest server through the production middleware wrappers.
type importRecorder struct{ *httptest.ResponseRecorder }

func newImportRecorder() *importRecorder                { return &importRecorder{httptest.NewRecorder()} }
func (*importRecorder) SetReadDeadline(time.Time) error { return nil }

func TestHandler_RejectsUploadsWhenDeadlinesAreUnsupported(t *testing.T) {
	body := &observedBody{Reader: bytes.NewReader(nil)}
	req := httptest.NewRequest(http.MethodPost, "/api/import", body)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.User{ID: 1}))
	response := httptest.NewRecorder() // intentionally has no SetReadDeadline
	NewHandler(nil).Import(response, req)
	if response.Code != http.StatusInternalServerError || body.read {
		t.Fatalf("unsupported deadline: status = %d, body read = %v", response.Code, body.read)
	}
}

type diskObservedBody struct {
	*bytes.Reader
	directory string
	spooled   bool
}

func (b *diskObservedBody) Read(p []byte) (int, error) {
	entries, _ := os.ReadDir(b.directory)
	for _, entry := range entries {
		info, _ := entry.Info()
		if info != nil && info.Size() > 0 {
			b.spooled = true
		}
	}
	if len(p) > 32768 {
		p = p[:32768]
	}
	return b.Reader.Read(p)
}
