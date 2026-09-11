package export

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/notes"
)

func TestExport_BuildFailureDoesNotReturnPartialArchive(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	user, err := auth.NewUserRepo(database).Create(context.Background(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	h := NewHandler(notes.NewService(notes.NewRepo(database)), database)
	h.build = func(w io.Writer, _ []*notes.Note, _ map[string]images.Data, _ string) error {
		_, _ = io.WriteString(w, "partial zip")
		return errors.New("finalise zip: disk full")
	}

	req := httptest.NewRequest(http.MethodPost, "/api/export", strings.NewReader(`{}`))
	req = req.WithContext(auth.WithUser(req.Context(), user))
	w := httptest.NewRecorder()
	h.Export(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "partial zip") {
		t.Fatalf("response contains partial archive: %q", w.Body.String())
	}
}

func TestExport_BuildFailureIsLoggedWithUserAndStage(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	user, err := auth.NewUserRepo(database).Create(context.Background(), "logger", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	h := NewHandler(notes.NewService(notes.NewRepo(database)), database)
	h.build = func(io.Writer, []*notes.Note, map[string]images.Data, string) error {
		return errors.New("finalise zip: writer failed")
	}

	var output bytes.Buffer
	oldLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(oldLogger) })

	req := httptest.NewRequest(http.MethodPost, "/api/export", strings.NewReader(`{}`))
	req = req.WithContext(auth.WithUser(req.Context(), user))
	h.Export(httptest.NewRecorder(), req)

	var entry map[string]any
	if err := json.Unmarshal(output.Bytes(), &entry); err != nil {
		t.Fatalf("decode log entry %q: %v", output.String(), err)
	}
	if got := entry["user_id"]; got != float64(user.ID) {
		t.Errorf("user_id = %v, want %d", got, user.ID)
	}
	if got := entry["stage"]; got != "build_archive" {
		t.Errorf("stage = %v, want build_archive", got)
	}
	if got := entry["error"]; got != "finalise zip: writer failed" {
		t.Errorf("error = %v, want finalise zip failure", got)
	}
}
