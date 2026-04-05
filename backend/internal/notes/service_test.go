package notes_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/notes"
)

func newTestService(t *testing.T) (*notes.Service, int64) {
	t.Helper()
	database := openTestDB(t)
	userID := seedUser(t, database)
	svc := notes.NewService(notes.NewRepo(database))
	return svc, userID
}

func TestService_Create_DefaultTitle(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, err := svc.Create(ctx, userID, "", "some body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	// Default title: "Note - YYYY-MM-DD HH:MM:SS"
	if !strings.HasPrefix(note.Title, "Note - ") {
		t.Fatalf("expected default title prefix, got %q", note.Title)
	}
	// Timestamp component should be parseable.
	ts := strings.TrimPrefix(note.Title, "Note - ")
	if _, err := time.Parse("2006-01-02 15:04:05", ts); err != nil {
		t.Fatalf("default title timestamp not parseable: %q", ts)
	}
}

func TestService_Create_WithTitle(t *testing.T) {
	svc, userID := newTestService(t)
	note, err := svc.Create(context.Background(), userID, "My Note", "body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if note.Title != "My Note" {
		t.Fatalf("expected 'My Note', got %q", note.Title)
	}
}

func TestService_Update_TitleFromFirstLine(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, _ := svc.Create(ctx, userID, "Original", "")

	// When the caller sets an explicit title, it should be stored.
	updated, err := svc.Update(ctx, note.ID, userID, "Renamed", "body text")
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Title != "Renamed" {
		t.Fatalf("expected 'Renamed', got %q", updated.Title)
	}
}

func TestService_ToggleStar(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, _ := svc.Create(ctx, userID, "T", "")

	toggled, err := svc.ToggleStar(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("ToggleStar: %v", err)
	}
	if !toggled.Starred {
		t.Fatal("expected starred after first toggle")
	}

	toggled, _ = svc.ToggleStar(ctx, note.ID, userID)
	if toggled.Starred {
		t.Fatal("expected unstarred after second toggle")
	}
}

func TestService_TogglePin(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, _ := svc.Create(ctx, userID, "T", "")
	toggled, err := svc.TogglePin(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("TogglePin: %v", err)
	}
	if !toggled.Pinned {
		t.Fatal("expected pinned after toggle")
	}
}

func TestService_Delete_MovesToTrash(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, _ := svc.Create(ctx, userID, "Gone", "")
	if err := svc.Delete(ctx, note.ID, userID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Normal get should fail.
	_, err := svc.Get(ctx, note.ID, userID)
	if err != notes.ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestService_WrongUser_Blocked(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	note, _ := svc.Create(ctx, userID, "Mine", "")

	// Another user (userID+1) should be blocked.
	_, err := svc.Get(ctx, note.ID, userID+1)
	if err != notes.ErrNotFound {
		t.Fatalf("expected ErrNotFound for wrong user on Get, got %v", err)
	}

	_, err = svc.Update(ctx, note.ID, userID+1, "Hack", "")
	if err != notes.ErrNotFound {
		t.Fatalf("expected ErrNotFound for wrong user on Update, got %v", err)
	}
}
