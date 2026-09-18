package trash_test

import (
	"context"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/trash"
)

func TestTrashService_PurgeExpiredUpdatesListAndRestoreBehavior(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	expiredID := seedNote(t, database, userID, "Expired")
	recentID := seedNote(t, database, userID, "Still recoverable")
	now := time.Date(2026, time.September, 18, 12, 0, 0, 0, time.UTC)
	for noteID, deletedAt := range map[int64]time.Time{
		expiredID: now.Add(-7 * 24 * time.Hour),
		recentID:  now.Add(-7*24*time.Hour + time.Second),
	} {
		if _, err := database.Exec(
			`INSERT INTO trash(note_id, user_id, deleted_at) VALUES(?,?,?)`,
			noteID, userID, deletedAt,
		); err != nil {
			t.Fatalf("insert trash entry: %v", err)
		}
	}

	svc := trash.NewService(trash.NewRepo(database))
	ctx := context.Background()
	if err := svc.PurgeExpired(ctx, now); err != nil {
		t.Fatalf("PurgeExpired: %v", err)
	}

	entries, err := svc.List(ctx, userID, "", 0, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 1 || entries[0].NoteID != recentID {
		t.Fatalf("expected only recent note in trash, got %+v", entries)
	}
	if err := svc.Restore(ctx, expiredID, userID); err != trash.ErrNotFound {
		t.Fatalf("restore expired note: got %v, want ErrNotFound", err)
	}
	if err := svc.Restore(ctx, recentID, userID); err != nil {
		t.Fatalf("restore recent note: %v", err)
	}
}
