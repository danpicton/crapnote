package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/notes"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/danpicton/crapnote/internal/trash"
)

// newTestMux builds a fully wired mux backed by an in-memory DB.
func newTestMux(t *testing.T) *http.ServeMux {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	authSvc := auth.NewService(
		auth.NewUserRepo(database),
		auth.NewSessionRepo(database),
		7*24*time.Hour,
	)
	notesSvc := notes.NewService(notes.NewRepo(database))
	return newMux(
		auth.NewHandler(authSvc),
		auth.NewAdminHandler(auth.NewUserRepo(database)),
		notes.NewHandler(notesSvc),
		tags.NewHandler(tags.NewService(tags.NewRepo(database))),
		trash.NewHandler(trash.NewService(trash.NewRepo(database))),
		export.NewHandler(notesSvc, database),
		images.NewHandler(database),
	)
}

func TestHealthCheck(t *testing.T) {
	mux := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("expected JSON body, got error: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %q", body["status"])
	}
}

func TestProtectedRouteRequiresAuth(t *testing.T) {
	mux := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated /api/auth/me, got %d", w.Code)
	}
}
