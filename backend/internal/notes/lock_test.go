package notes_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/notes"
)

// ── repository ───────────────────────────────────────────────────────────────

func TestNoteRepo_NewNoteIsUnlocked(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)

	note, err := repo.Create(context.Background(), userID, "Fresh", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if note.Locked {
		t.Fatal("a newly created note should not be locked")
	}
}

func TestNoteRepo_SetLocked(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Lock me", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := repo.SetLocked(ctx, note.ID, userID, true); err != nil {
		t.Fatalf("SetLocked(true): %v", err)
	}
	got, err := repo.Get(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !got.Locked {
		t.Fatal("expected note to be locked")
	}

	if err := repo.SetLocked(ctx, note.ID, userID, false); err != nil {
		t.Fatalf("SetLocked(false): %v", err)
	}
	got, err = repo.Get(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Locked {
		t.Fatal("expected note to be unlocked")
	}
}

func TestNoteRepo_SetLocked_OtherUser(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Mine", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := repo.SetLocked(ctx, note.ID, userID+999, true); !errors.Is(err, notes.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for another user, got %v", err)
	}
}

func TestNoteRepo_ListIncludesLockedFlag(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Listed", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := repo.SetLocked(ctx, note.ID, userID, true); err != nil {
		t.Fatalf("SetLocked: %v", err)
	}

	list, err := repo.List(ctx, userID, notes.ListFilter{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 note, got %d", len(list))
	}
	if !list[0].Locked {
		t.Fatal("List should surface the locked flag")
	}
}

func TestNoteRepo_ListArchivedIncludesLockedFlag(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Archived", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := repo.Archive(ctx, note.ID, userID); err != nil {
		t.Fatalf("Archive: %v", err)
	}
	if err := repo.SetLocked(ctx, note.ID, userID, true); err != nil {
		t.Fatalf("SetLocked: %v", err)
	}

	list, err := repo.ListArchived(ctx, userID, 0, 0)
	if err != nil {
		t.Fatalf("ListArchived: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 archived note, got %d", len(list))
	}
	if !list[0].Locked {
		t.Fatal("ListArchived should surface the locked flag")
	}
}

// ── auto-lock ────────────────────────────────────────────────────────────────

// backdateNote rewrites updated_at directly so we can simulate a stale note
// without waiting seven days.
func backdateNote(t *testing.T, database *db.DB, id int64, age time.Duration) {
	t.Helper()
	if _, err := database.Exec(
		`UPDATE notes SET updated_at = ? WHERE id = ?`,
		time.Now().UTC().Add(-age), id,
	); err != nil {
		t.Fatalf("backdateNote: %v", err)
	}
}

func TestNoteRepo_AutoLockStale(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	stale, err := repo.Create(ctx, userID, "Old", "body")
	if err != nil {
		t.Fatalf("Create stale: %v", err)
	}
	fresh, err := repo.Create(ctx, userID, "New", "body")
	if err != nil {
		t.Fatalf("Create fresh: %v", err)
	}
	backdateNote(t, database, stale.ID, 8*24*time.Hour)

	n, err := repo.AutoLockStale(ctx, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("AutoLockStale: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 note locked, got %d", n)
	}

	got, err := repo.Get(ctx, stale.ID, userID)
	if err != nil {
		t.Fatalf("Get stale: %v", err)
	}
	if !got.Locked {
		t.Fatal("stale note should have been auto-locked")
	}

	got, err = repo.Get(ctx, fresh.ID, userID)
	if err != nil {
		t.Fatalf("Get fresh: %v", err)
	}
	if got.Locked {
		t.Fatal("recently updated note should not be auto-locked")
	}
}

// Auto-locking must not itself count as touching the note, otherwise every
// locked note's updated_at would creep forward on each run.
func TestNoteRepo_AutoLockStale_PreservesUpdatedAt(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Old", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	backdateNote(t, database, note.ID, 30*24*time.Hour)

	before, err := repo.Get(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("Get before: %v", err)
	}
	if _, err := repo.AutoLockStale(ctx, 7*24*time.Hour); err != nil {
		t.Fatalf("AutoLockStale: %v", err)
	}
	after, err := repo.Get(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("Get after: %v", err)
	}
	if !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("auto-lock changed updated_at: %v -> %v", before.UpdatedAt, after.UpdatedAt)
	}
}

// Re-running the job must not report already-locked notes as newly locked.
func TestNoteRepo_AutoLockStale_Idempotent(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Old", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	backdateNote(t, database, note.ID, 8*24*time.Hour)

	if _, err := repo.AutoLockStale(ctx, 7*24*time.Hour); err != nil {
		t.Fatalf("first AutoLockStale: %v", err)
	}
	n, err := repo.AutoLockStale(ctx, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("second AutoLockStale: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected 0 newly locked on second run, got %d", n)
	}
}

// Trashed notes are on their way out; the job should leave them alone.
func TestNoteRepo_AutoLockStale_SkipsTrashed(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Old", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	backdateNote(t, database, note.ID, 8*24*time.Hour)
	if err := repo.SoftDelete(ctx, note.ID, userID); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}

	n, err := repo.AutoLockStale(ctx, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("AutoLockStale: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected trashed notes to be skipped, got %d locked", n)
	}
}

// ── service ──────────────────────────────────────────────────────────────────

func TestService_ToggleLock(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, err := svc.Create(ctx, userID, "Toggle", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	locked, err := svc.ToggleLock(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("ToggleLock: %v", err)
	}
	if !locked.Locked {
		t.Fatal("expected note to be locked after first toggle")
	}

	unlocked, err := svc.ToggleLock(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("ToggleLock again: %v", err)
	}
	if unlocked.Locked {
		t.Fatal("expected note to be unlocked after second toggle")
	}
}

func TestService_Update_RejectsLockedNote(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, err := svc.Create(ctx, userID, "Locked", "original body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := svc.ToggleLock(ctx, note.ID, userID); err != nil {
		t.Fatalf("ToggleLock: %v", err)
	}

	if _, err := svc.Update(ctx, note.ID, userID, strPtr("hacked"), strPtr("new body")); !errors.Is(err, notes.ErrLocked) {
		t.Fatalf("expected ErrLocked, got %v", err)
	}

	got, err := svc.Get(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Title != "Locked" || got.Body != "original body" {
		t.Fatalf("locked note was modified: %+v", got)
	}
}

func TestService_Delete_RejectsLockedNote(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, err := svc.Create(ctx, userID, "Locked", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := svc.ToggleLock(ctx, note.ID, userID); err != nil {
		t.Fatalf("ToggleLock: %v", err)
	}

	if err := svc.Delete(ctx, note.ID, userID); !errors.Is(err, notes.ErrLocked) {
		t.Fatalf("expected ErrLocked, got %v", err)
	}
	if _, err := svc.Get(ctx, note.ID, userID); err != nil {
		t.Fatalf("locked note should still exist: %v", err)
	}
}

// Star and pin are metadata rather than content, so they stay available while
// a note is locked.
func TestService_MetadataOpsAllowedOnLockedNote(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, err := svc.Create(ctx, userID, "Locked", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := svc.ToggleLock(ctx, note.ID, userID); err != nil {
		t.Fatalf("ToggleLock: %v", err)
	}

	if _, err := svc.ToggleStar(ctx, note.ID, userID); err != nil {
		t.Fatalf("ToggleStar on locked note: %v", err)
	}
	if _, err := svc.TogglePin(ctx, note.ID, userID); err != nil {
		t.Fatalf("TogglePin on locked note: %v", err)
	}
}

// Unlocking is the escape hatch — it must work on a locked note.
func TestService_UnlockThenUpdate(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, err := svc.Create(ctx, userID, "Locked", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := svc.ToggleLock(ctx, note.ID, userID); err != nil {
		t.Fatalf("lock: %v", err)
	}
	if _, err := svc.ToggleLock(ctx, note.ID, userID); err != nil {
		t.Fatalf("unlock: %v", err)
	}
	if _, err := svc.Update(ctx, note.ID, userID, strPtr("edited"), nil); err != nil {
		t.Fatalf("Update after unlock: %v", err)
	}
}

func TestService_AutoLockStale(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	svc := notes.NewService(repo)
	ctx := context.Background()

	note, err := svc.Create(ctx, userID, "Old", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	backdateNote(t, database, note.ID, 8*24*time.Hour)

	n, err := svc.AutoLockStale(ctx, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("AutoLockStale: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 locked, got %d", n)
	}
}

// ── handler ──────────────────────────────────────────────────────────────────

func TestNotesHandler_ToggleLock(t *testing.T) {
	h, user := newHandlerFixture(t)

	created := createNoteViaHandler(t, h, user, `{"title":"Lock","body":"body"}`)

	req := httptest.NewRequest(http.MethodPatch, "/api/notes/1/lock", nil)
	req.SetPathValue("id", created)
	req = withUser(req, user)
	w := httptest.NewRecorder()

	h.ToggleLock(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Locked bool `json:"locked"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Locked {
		t.Fatal("expected locked=true in response")
	}
}

func TestNotesHandler_Update_LockedReturns423(t *testing.T) {
	h, user := newHandlerFixture(t)
	id := createNoteViaHandler(t, h, user, `{"title":"Lock","body":"body"}`)
	lockNoteViaHandler(t, h, user, id)

	req := httptest.NewRequest(http.MethodPut, "/api/notes/"+id,
		strings.NewReader(`{"title":"hacked"}`))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", id)
	req = withUser(req, user)
	w := httptest.NewRecorder()

	h.Update(w, req)

	if w.Code != http.StatusLocked {
		t.Fatalf("expected 423, got %d: %s", w.Code, w.Body.String())
	}
}

func TestNotesHandler_Delete_LockedReturns423(t *testing.T) {
	h, user := newHandlerFixture(t)
	id := createNoteViaHandler(t, h, user, `{"title":"Lock","body":"body"}`)
	lockNoteViaHandler(t, h, user, id)

	req := httptest.NewRequest(http.MethodDelete, "/api/notes/"+id, nil)
	req.SetPathValue("id", id)
	req = withUser(req, user)
	w := httptest.NewRecorder()

	h.Delete(w, req)

	if w.Code != http.StatusLocked {
		t.Fatalf("expected 423, got %d: %s", w.Code, w.Body.String())
	}
}

func TestNotesHandler_Archive_LockedReturns423(t *testing.T) {
	h, user := newHandlerFixture(t)
	id := createNoteViaHandler(t, h, user, `{"title":"Lock","body":"body"}`)
	lockNoteViaHandler(t, h, user, id)

	req := httptest.NewRequest(http.MethodPatch, "/api/notes/"+id+"/archive", nil)
	req.SetPathValue("id", id)
	req = withUser(req, user)
	w := httptest.NewRecorder()

	h.Archive(w, req)

	if w.Code != http.StatusLocked {
		t.Fatalf("expected 423, got %d: %s", w.Code, w.Body.String())
	}
}

func TestNotesHandler_CreateResponseIncludesLocked(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/notes",
		strings.NewReader(`{"title":"Hello","body":"World"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()

	h.Create(w, req)

	var raw map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	locked, ok := raw["locked"]
	if !ok {
		t.Fatalf("response missing 'locked' field: %s", w.Body.String())
	}
	if locked != false {
		t.Fatalf("expected locked=false, got %v", locked)
	}
}

// ── handler test helpers ─────────────────────────────────────────────────────

func createNoteViaHandler(t *testing.T, h *notes.Handler, user *auth.User, body string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/notes", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create note: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode created note: %v", err)
	}
	return strconv.FormatInt(resp.ID, 10)
}

func lockNoteViaHandler(t *testing.T, h *notes.Handler, user *auth.User, id string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, "/api/notes/"+id+"/lock", nil)
	req.SetPathValue("id", id)
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.ToggleLock(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("lock note: expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── the write statements are themselves the enforcement point ────────────────
//
// The service checks locked before writing, but that check and the write are
// two statements: a concurrent SetLocked or AutoLockStale can slip between
// them. These tests bypass the service and call the repo directly, so they
// only pass if the UPDATE/soft-delete refuse a locked note on their own.

func TestNoteRepo_Update_RejectsLockedNote(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Locked", "original body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := repo.SetLocked(ctx, note.ID, userID, true); err != nil {
		t.Fatalf("SetLocked: %v", err)
	}

	if _, err := repo.Update(ctx, note.ID, userID, strPtr("hacked"), strPtr("new body")); !errors.Is(err, notes.ErrLocked) {
		t.Fatalf("expected ErrLocked, got %v", err)
	}

	got, err := repo.Get(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Title != "Locked" || got.Body != "original body" {
		t.Fatalf("locked note was modified: %+v", got)
	}
}

func TestNoteRepo_Update_MissingNoteIsNotFound(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)

	if _, err := repo.Update(context.Background(), 9999, userID, strPtr("x"), nil); !errors.Is(err, notes.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestNoteRepo_SoftDelete_RejectsLockedNote(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Locked", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := repo.SetLocked(ctx, note.ID, userID, true); err != nil {
		t.Fatalf("SetLocked: %v", err)
	}

	if err := repo.SoftDelete(ctx, note.ID, userID); !errors.Is(err, notes.ErrLocked) {
		t.Fatalf("expected ErrLocked, got %v", err)
	}

	var trashed int
	if err := database.QueryRow(`SELECT COUNT(*) FROM trash WHERE note_id = ?`, note.ID).Scan(&trashed); err != nil {
		t.Fatalf("count trash: %v", err)
	}
	if trashed != 0 {
		t.Fatalf("locked note was trashed: %d rows", trashed)
	}
}

func TestNoteRepo_Archive_RejectsLockedNote(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Locked", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := repo.SetLocked(ctx, note.ID, userID, true); err != nil {
		t.Fatalf("SetLocked: %v", err)
	}

	if err := repo.Archive(ctx, note.ID, userID); !errors.Is(err, notes.ErrLocked) {
		t.Fatalf("expected ErrLocked, got %v", err)
	}
	if _, err := repo.Get(ctx, note.ID, userID); err != nil {
		t.Fatalf("locked note should remain in the main list: %v", err)
	}
}

func TestNoteRepo_SoftDelete_MissingNoteIsNotFound(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)

	if err := repo.SoftDelete(context.Background(), 9999, userID); !errors.Is(err, notes.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
