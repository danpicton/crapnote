package export

import (
	"context"
	"errors"
	"io"
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
