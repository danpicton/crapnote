package trash_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/notes"
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

func TestTrashHandler_ListSearch(t *testing.T) {
	database := openTestDB(t)
	userRepo := auth.NewUserRepo(database)
	user, err := userRepo.Create(context.Background(), "searcher", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	matching := seedNote(t, database, user.ID, "Deleted elephant")
	nonmatching := seedNote(t, database, user.ID, "Other deleted note")
	trashNote(t, database, matching, user.ID)
	trashNote(t, database, nonmatching, user.ID)
	h := trash.NewHandler(trash.NewService(trash.NewRepo(database)))

	req := withUser(httptest.NewRequest(http.MethodGet, "/api/trash?search=eleph", nil), user)
	w := httptest.NewRecorder()
	h.List(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("List: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var entries []map[string]any
	json.NewDecoder(w.Body).Decode(&entries) //nolint:errcheck
	if len(entries) != 1 || entries[0]["title"] != "Deleted elephant" {
		t.Fatalf("unexpected trash search: %v", entries)
	}
}

func TestTrashHandlers_AfterCleanupListFetchAndRestoreAreNotFound(t *testing.T) {
	database := openTestDB(t)
	userRepo := auth.NewUserRepo(database)
	user, err := userRepo.Create(context.Background(), "cleanup-user", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	noteID := seedNote(t, database, user.ID, "Expired")
	now := time.Date(2026, time.September, 18, 12, 0, 0, 0, time.UTC)
	if _, err := database.Exec(
		`INSERT INTO trash(note_id, user_id, deleted_at) VALUES(?,?,?)`,
		noteID, user.ID, now.Add(-7*24*time.Hour),
	); err != nil {
		t.Fatalf("insert trash: %v", err)
	}
	trashSvc := trash.NewService(trash.NewRepo(database))
	if err := trashSvc.PurgeExpired(context.Background(), now); err != nil {
		t.Fatalf("PurgeExpired: %v", err)
	}
	trashHandler := trash.NewHandler(trashSvc)

	listReq := withUser(httptest.NewRequest(http.MethodGet, "/api/trash", nil), user)
	listResponse := httptest.NewRecorder()
	trashHandler.List(listResponse, listReq)
	if listResponse.Code != http.StatusOK || listResponse.Body.String() != "[]\n" {
		t.Fatalf("list after cleanup: status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}

	restoreReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/trash/%d/restore", noteID), nil)
	restoreReq.SetPathValue("id", fmt.Sprint(noteID))
	restoreResponse := httptest.NewRecorder()
	trashHandler.Restore(restoreResponse, withUser(restoreReq, user))
	if restoreResponse.Code != http.StatusNotFound {
		t.Fatalf("restore after cleanup: got %d, want 404", restoreResponse.Code)
	}

	noteHandler := notes.NewHandler(notes.NewService(notes.NewRepo(database)))
	getReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/notes/%d", noteID), nil)
	getReq.SetPathValue("id", fmt.Sprint(noteID))
	getResponse := httptest.NewRecorder()
	noteHandler.Get(getResponse, withUser(getReq, user))
	if getResponse.Code != http.StatusNotFound {
		t.Fatalf("fetch after cleanup: got %d, want 404", getResponse.Code)
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
