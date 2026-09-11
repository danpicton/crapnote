package export_test

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	yzip "github.com/yeka/zip"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/notes"
)

func setup(t *testing.T) (*export.Handler, *auth.User) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	userRepo := auth.NewUserRepo(database)
	user, err := userRepo.Create(context.Background(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	notesRepo := notes.NewRepo(database)
	notesSvc := notes.NewService(notesRepo)
	notesSvc.Create(context.Background(), user.ID, "First Note", "body one")  //nolint:errcheck
	notesSvc.Create(context.Background(), user.ID, "Second Note", "body two") //nolint:errcheck

	h := export.NewHandler(notesSvc, database)
	return h, user
}

func withUser(r *http.Request, u *auth.User) *http.Request {
	return r.WithContext(auth.WithUser(r.Context(), u))
}

func TestExport_NoPassword(t *testing.T) {
	h, user := setup(t)

	req := httptest.NewRequest(http.MethodPost, "/api/export", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Export(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	ct := w.Header().Get("Content-Type")
	if ct != "application/zip" {
		t.Fatalf("expected application/zip, got %q", ct)
	}

	// Parse ZIP and verify contents.
	body := w.Body.Bytes()
	zr, err := yzip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("parse zip: %v", err)
	}
	if len(zr.File) != 2 {
		t.Fatalf("expected 2 files, got %d", len(zr.File))
	}

	names := make(map[string]bool)
	for _, f := range zr.File {
		names[f.Name] = true
		if !strings.HasSuffix(f.Name, ".md") {
			t.Fatalf("expected .md extension, got %q", f.Name)
		}
	}
	if !names["first-note.md"] {
		t.Fatalf("expected first-note.md in archive, got %v", names)
	}
}

func TestExport_IncludesArchivedNotes(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	user, err := auth.NewUserRepo(database).Create(context.Background(), "archiver", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	notesSvc := notes.NewService(notes.NewRepo(database))
	if _, err := notesSvc.Create(context.Background(), user.ID, "Live Note", "live body"); err != nil {
		t.Fatalf("create live note: %v", err)
	}
	archived, err := notesSvc.Create(context.Background(), user.ID, "Archived Note", "archived body")
	if err != nil {
		t.Fatalf("create archived note: %v", err)
	}
	if err := notesSvc.Archive(context.Background(), archived.ID, user.ID); err != nil {
		t.Fatalf("archive note: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/export", strings.NewReader(`{}`))
	req = withUser(req, user)
	w := httptest.NewRecorder()
	export.NewHandler(notesSvc, database).Export(w, req)

	zr, err := yzip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf("parse zip: %v", err)
	}
	names := make(map[string]bool)
	for _, file := range zr.File {
		names[file.Name] = true
	}
	if !names["live-note.md"] || !names["archived-note.md"] {
		t.Fatalf("expected live and archived notes, got %v", names)
	}
}

func TestExport_IncludesImagesReferencedOnlyByArchivedNotes(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	user, err := auth.NewUserRepo(database).Create(context.Background(), "image-archiver", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	const imageID = "12345678-1234-1234-1234-123456789abc"
	imageBytes := []byte("png data")
	if _, err := database.ExecContext(context.Background(),
		`INSERT INTO images (id, user_id, mime_type, data) VALUES (?, ?, ?, ?)`,
		imageID, user.ID, "image/png", imageBytes,
	); err != nil {
		t.Fatalf("create image: %v", err)
	}

	notesSvc := notes.NewService(notes.NewRepo(database))
	if _, err := notesSvc.Create(context.Background(), user.ID, "Live Note", "no image"); err != nil {
		t.Fatalf("create live note: %v", err)
	}
	archived, err := notesSvc.Create(context.Background(), user.ID, "Archived Image", "![archived](/api/images/"+imageID+")")
	if err != nil {
		t.Fatalf("create archived note: %v", err)
	}
	if err := notesSvc.Archive(context.Background(), archived.ID, user.ID); err != nil {
		t.Fatalf("archive note: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/export", strings.NewReader(`{}`))
	req = withUser(req, user)
	w := httptest.NewRecorder()
	export.NewHandler(notesSvc, database).Export(w, req)

	zr, err := yzip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatalf("parse zip: %v", err)
	}
	files := make(map[string]*yzip.File)
	for _, file := range zr.File {
		files[file.Name] = file
	}
	imageName := "images/" + imageID + ".png"
	if files[imageName] == nil {
		t.Fatalf("expected %q in archive, got %v", imageName, files)
	}
	bodyFile := files["archived-image.md"]
	if bodyFile == nil {
		t.Fatalf("expected archived-image.md in archive, got %v", files)
	}
	r, err := bodyFile.Open()
	if err != nil {
		t.Fatalf("open archived note: %v", err)
	}
	defer r.Close()
	body, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("read archived note: %v", err)
	}
	if !strings.Contains(string(body), "![archived]("+imageName+")") {
		t.Fatalf("expected rewritten image path in archived note, got %q", body)
	}
}

func TestExport_WithPassword(t *testing.T) {
	h, user := setup(t)

	req := httptest.NewRequest(http.MethodPost, "/api/export", strings.NewReader(`{"password":"secret"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Export(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Encrypted ZIP should not be parseable without a password.
	body := w.Body.Bytes()
	zr, err := yzip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("parse zip wrapper: %v", err)
	}
	if len(zr.File) != 2 {
		t.Fatalf("expected 2 encrypted files, got %d", len(zr.File))
	}
	// Each entry should be encrypted.
	for _, f := range zr.File {
		if !f.IsEncrypted() {
			t.Fatalf("expected file %q to be encrypted", f.Name)
		}
	}
}

func TestExport_FilenamesSanitised(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	userRepo := auth.NewUserRepo(database)
	user, _ := userRepo.Create(context.Background(), "bob", "$2a$12$x", false)
	notesSvc := notes.NewService(notes.NewRepo(database))
	notesSvc.Create(context.Background(), user.ID, "Hello/World & More!", "body") //nolint:errcheck

	h := export.NewHandler(notesSvc, database)
	req := httptest.NewRequest(http.MethodPost, "/api/export", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Export(w, req)

	body := w.Body.Bytes()
	zr, _ := yzip.NewReader(bytes.NewReader(body), int64(len(body)))
	if len(zr.File) != 1 {
		t.Fatalf("expected 1 file, got %d", len(zr.File))
	}
	name := zr.File[0].Name
	if strings.ContainsAny(name, "/\\:*?\"<>|") {
		t.Fatalf("filename contains unsafe characters: %q", name)
	}
}

func TestExport_EmptyNotes(t *testing.T) {
	database, _ := db.Open(db.Config{SQLitePath: ":memory:"})
	t.Cleanup(func() { database.Close() })
	userRepo := auth.NewUserRepo(database)
	user, _ := userRepo.Create(context.Background(), "empty", "$2a$12$x", false)
	h := export.NewHandler(notes.NewService(notes.NewRepo(database)), database)

	req := httptest.NewRequest(http.MethodPost, "/api/export", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Export(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for empty export, got %d", w.Code)
	}
	body := w.Body.Bytes()
	zr, err := yzip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("parse empty zip: %v", err)
	}
	if len(zr.File) != 0 {
		t.Fatalf("expected 0 files, got %d", len(zr.File))
	}
}
