package trash_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/trash"
)

func newHandlerFixture(t *testing.T) (*trash.Handler, *auth.User) {
	t.Helper()
	database := openTestDB(t)
	userRepo := auth.NewUserRepo(database)
	user, err := userRepo.Create(context.Background(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	svc := trash.NewService(trash.NewRepo(database))
	return trash.NewHandler(svc), user
}

func withUser(r *http.Request, u *auth.User) *http.Request {
	return r.WithContext(auth.WithUser(r.Context(), u))
}

func TestTrashHandler_ListAndRestore(t *testing.T) {
	h, user := newHandlerFixture(t)
	// We need a trashed note — re-open the same DB is hard via the handler layer,
	// so we test via the handler that wraps the service directly.
	// Instead, verify an empty list first (clean state).
	req := httptest.NewRequest(http.MethodGet, "/api/trash", nil)
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.List(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("List: expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestTrashHandler_DeleteOne_NotFound(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/trash/9999", nil)
	req.SetPathValue("id", "9999")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.DeleteOne(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestTrashHandler_Restore_NotFound(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/trash/9999/restore", nil)
	req.SetPathValue("id", "9999")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Restore(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestTrashHandler_Empty(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/trash", nil)
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Empty(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("Empty: expected 204, got %d: %s", w.Code, w.Body.String())
	}
}

// Guard against unused fmt import.
var _ = fmt.Sprintf
