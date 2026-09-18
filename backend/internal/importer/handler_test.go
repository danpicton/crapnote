package importer_test

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/importer"
	"github.com/danpicton/crapnote/internal/notes"
)

func TestHandler_ImportsPlainAndEncryptedExports(t *testing.T) {
	tests := []struct {
		name     string
		password string
	}{
		{name: "plain"},
		{name: "AES-256 encrypted", password: "secret"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			handler, user, database := importHandlerFixture(t)
			var archive bytes.Buffer
			if err := export.Build(&archive, []*notes.Note{{Title: "Imported", Body: "body"}}, nil, tc.password); err != nil {
				t.Fatalf("build export: %v", err)
			}
			req := importRequest(t, archive.Bytes(), tc.password)
			req = req.WithContext(auth.WithUser(req.Context(), user))
			response := httptest.NewRecorder()

			handler.Import(response, req)

			if response.Code != http.StatusCreated {
				t.Fatalf("status = %d: %s", response.Code, response.Body.String())
			}
			var result importer.Result
			if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
				t.Fatalf("decode result: %v", err)
			}
			if result.ImportedNotes != 1 {
				t.Fatalf("imported notes = %d", result.ImportedNotes)
			}
			var count int
			if err := database.QueryRow(`SELECT COUNT(*) FROM notes WHERE user_id = ?`, user.ID).Scan(&count); err != nil || count != 1 {
				t.Fatalf("stored notes = %d, error %v", count, err)
			}
		})
	}
}

func TestHandler_PasswordAndEmptyArchiveErrorsAreActionableAndAtomic(t *testing.T) {
	var encrypted bytes.Buffer
	if err := export.Build(&encrypted, []*notes.Note{{Title: "Secret", Body: "body"}}, nil, "correct"); err != nil {
		t.Fatalf("build encrypted export: %v", err)
	}
	tests := []struct {
		name     string
		archive  []byte
		password string
		message  string
	}{
		{name: "missing password", archive: encrypted.Bytes(), message: "password-protected"},
		{name: "wrong password", archive: encrypted.Bytes(), password: "wrong", message: "check the password"},
		{name: "no notes", archive: makeZIP(t, map[string][]byte{"images/image.png": testPNG()}), message: "no note entries"},
		{name: "corrupt", archive: []byte("not a ZIP"), message: "invalid or corrupt ZIP"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			handler, user, database := importHandlerFixture(t)
			req := importRequest(t, tc.archive, tc.password)
			req = req.WithContext(auth.WithUser(req.Context(), user))
			response := httptest.NewRecorder()

			handler.Import(response, req)

			if response.Code != http.StatusBadRequest || !bytes.Contains(response.Body.Bytes(), []byte(tc.message)) {
				t.Fatalf("status/body = %d %q, want actionable %q", response.Code, response.Body.String(), tc.message)
			}
			var noteCount, imageCount int
			_ = database.QueryRow(`SELECT COUNT(*) FROM notes`).Scan(&noteCount)
			_ = database.QueryRow(`SELECT COUNT(*) FROM images`).Scan(&imageCount)
			if noteCount != 0 || imageCount != 0 {
				t.Fatalf("failed import stored %d notes and %d images", noteCount, imageCount)
			}
		})
	}
}

func TestHandler_RequiresAuthentication(t *testing.T) {
	handler, _, _ := importHandlerFixture(t)
	response := httptest.NewRecorder()
	handler.Import(response, importRequest(t, makeZIP(t, map[string][]byte{"note.md": []byte("# Note\n\n\n")}), ""))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func importHandlerFixture(t *testing.T) (*importer.Handler, *auth.User, *db.DB) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	user, err := auth.NewUserRepo(database).Create(context.Background(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	service := importer.NewService(database, importer.DefaultConfig())
	return importer.NewHandler(service), user, database
}

func importRequest(t *testing.T, archive []byte, password string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("archive", "backup.zip")
	if err != nil {
		t.Fatalf("create archive field: %v", err)
	}
	if _, err := file.Write(archive); err != nil {
		t.Fatalf("write archive field: %v", err)
	}
	if password != "" {
		if err := writer.WriteField("password", password); err != nil {
			t.Fatalf("write password: %v", err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/import", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}
