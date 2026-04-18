package trash_test

import (
	"context"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/trash"
)

func openTestDB(t *testing.T) *db.DB {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("openTestDB: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func seedUser(t *testing.T, database *db.DB) int64 {
	t.Helper()
	res, _ := database.Exec(`INSERT INTO users(username, password_hash) VALUES(?,?)`, "u", "h")
	id, _ := res.LastInsertId()
	return id
}

func seedNote(t *testing.T, database *db.DB, userID int64, title string) int64 {
	t.Helper()
	res, _ := database.Exec(
		`INSERT INTO notes(user_id, title, body) VALUES(?,?,?)`, userID, title, "",
	)
	id, _ := res.LastInsertId()
	return id
}

func trashNote(t *testing.T, database *db.DB, noteID, userID int64) {
	t.Helper()
	_, err := database.Exec(
		`INSERT INTO trash(note_id, user_id) VALUES(?,?)`, noteID, userID,
	)
	if err != nil {
		t.Fatalf("trashNote: %v", err)
	}
}

func TestTrashRepo_List(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	noteID := seedNote(t, database, userID, "Gone")
	trashNote(t, database, noteID, userID)

	repo := trash.NewRepo(database)
	entries, err := repo.List(context.Background(), userID, 0, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	e := entries[0]
	if e.NoteID != noteID || e.Title != "Gone" {
		t.Fatalf("unexpected entry: %+v", e)
	}
	if e.PermanentDeleteAt.IsZero() {
		t.Fatal("PermanentDeleteAt must be set")
	}
}

func TestTrashRepo_Restore(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	noteID := seedNote(t, database, userID, "Restore me")
	trashNote(t, database, noteID, userID)

	repo := trash.NewRepo(database)
	ctx := context.Background()

	if err := repo.Restore(ctx, noteID, userID); err != nil {
		t.Fatalf("Restore: %v", err)
	}

	entries, _ := repo.List(ctx, userID, 0, 0)
	if len(entries) != 0 {
		t.Fatal("note should no longer be in trash after restore")
	}

	// The underlying note should still exist.
	var count int
	database.QueryRow(`SELECT COUNT(*) FROM notes WHERE id=?`, noteID).Scan(&count) //nolint:errcheck
	if count != 1 {
		t.Fatal("note row should still exist after restore")
	}
}

func TestTrashRepo_Restore_WrongUser(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	noteID := seedNote(t, database, userID, "N")
	trashNote(t, database, noteID, userID)

	repo := trash.NewRepo(database)
	if err := repo.Restore(context.Background(), noteID, userID+1); err != trash.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestTrashRepo_DeleteOne(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	noteID := seedNote(t, database, userID, "Perm delete")
	trashNote(t, database, noteID, userID)

	repo := trash.NewRepo(database)
	ctx := context.Background()

	if err := repo.DeleteOne(ctx, noteID, userID); err != nil {
		t.Fatalf("DeleteOne: %v", err)
	}

	// Note row should be gone.
	var count int
	database.QueryRow(`SELECT COUNT(*) FROM notes WHERE id=?`, noteID).Scan(&count) //nolint:errcheck
	if count != 0 {
		t.Fatal("note row should be removed after permanent delete")
	}
}

func TestTrashRepo_DeleteOne_WrongUser(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	noteID := seedNote(t, database, userID, "N")
	trashNote(t, database, noteID, userID)

	repo := trash.NewRepo(database)
	if err := repo.DeleteOne(context.Background(), noteID, userID+1); err != trash.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestTrashRepo_Empty(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	n1 := seedNote(t, database, userID, "A")
	n2 := seedNote(t, database, userID, "B")
	trashNote(t, database, n1, userID)
	trashNote(t, database, n2, userID)

	repo := trash.NewRepo(database)
	ctx := context.Background()

	if err := repo.Empty(ctx, userID); err != nil {
		t.Fatalf("Empty: %v", err)
	}

	entries, _ := repo.List(ctx, userID, 0, 0)
	if len(entries) != 0 {
		t.Fatalf("expected empty trash, got %d entries", len(entries))
	}

	var noteCount int
	database.QueryRow(`SELECT COUNT(*) FROM notes WHERE user_id=?`, userID).Scan(&noteCount) //nolint:errcheck
	if noteCount != 0 {
		t.Fatalf("expected all notes deleted, got %d", noteCount)
	}
}

func TestTrashRepo_PurgeExpired(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	oldNote := seedNote(t, database, userID, "Old")
	newNote := seedNote(t, database, userID, "New")

	// Insert trash entries with explicit deleted_at to simulate age.
	past := time.Now().Add(-8 * 24 * time.Hour).UTC()
	database.Exec(`INSERT INTO trash(note_id, user_id, deleted_at) VALUES(?,?,?)`, oldNote, userID, past) //nolint:errcheck
	trashNote(t, database, newNote, userID)

	repo := trash.NewRepo(database)
	ctx := context.Background()

	if err := repo.PurgeExpired(ctx); err != nil {
		t.Fatalf("PurgeExpired: %v", err)
	}

	// Old note should be gone.
	var oldCount int
	database.QueryRow(`SELECT COUNT(*) FROM notes WHERE id=?`, oldNote).Scan(&oldCount) //nolint:errcheck
	if oldCount != 0 {
		t.Fatal("old note should be permanently deleted")
	}

	// New note should still be in trash.
	entries, _ := repo.List(ctx, userID, 0, 0)
	if len(entries) != 1 || entries[0].NoteID != newNote {
		t.Fatalf("recent note should remain in trash, got %v", entries)
	}
}
