package importer

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/internal/auth"
)

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
	response := httptest.NewRecorder()
	(&Handler{maxUploadBytes: 1}).Import(response, req)

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
}
