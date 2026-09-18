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
	entries, err := repo.List(context.Background(), userID, "", 0, 0)
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

func TestTrashRepo_List_SearchesTitleAndBody(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	titleMatch := seedNote(t, database, userID, "Deleted elephant")
	bodyMatch := seedNote(t, database, userID, "Deleted body")
	activeMatch := seedNote(t, database, userID, "Active elephant")
	_, _ = database.Exec(`UPDATE notes SET body = ? WHERE id = ?`, "elephantine detail", bodyMatch)
	trashNote(t, database, titleMatch, userID)
	trashNote(t, database, bodyMatch, userID)

	repo := trash.NewRepo(database)
	entries, err := repo.List(context.Background(), userID, "eleph", 0, 0)
	if err != nil {
		t.Fatalf("List search: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected title and body matches only, got %+v", entries)
	}
	for _, entry := range entries {
		if entry.NoteID == activeMatch {
			t.Fatalf("search leaked active note: %+v", entry)
		}
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

	entries, _ := repo.List(ctx, userID, "", 0, 0)
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

	entries, _ := repo.List(ctx, userID, "", 0, 0)
	if len(entries) != 0 {
		t.Fatalf("expected empty trash, got %d entries", len(entries))
	}

	var noteCount int
	database.QueryRow(`SELECT COUNT(*) FROM notes WHERE user_id=?`, userID).Scan(&noteCount) //nolint:errcheck
	if noteCount != 0 {
		t.Fatalf("expected all notes deleted, got %d", noteCount)
	}
}

func TestTrashRepo_PurgeExpired_UsesSevenDayBoundaryAcrossStoredTimestampFormats(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	now := time.Date(2026, time.September, 18, 12, 0, 0, 0, time.UTC)
	cutoff := now.Add(-trash.PurgeDays * 24 * time.Hour)

	tests := []struct {
		name      string
		deletedAt any
		wantNote  bool
	}{
		{
			name: "just before expiry remains recoverable",
			// RFC3339 offsets can be produced by imported or legacy rows.
			deletedAt: cutoff.Add(time.Second).In(time.FixedZone("UTC+0530", 5*60*60+30*60)).Format(time.RFC3339),
			wantNote:  true,
		},
		{
			name: "exact expiry is purged",
			// CURRENT_TIMESTAMP, used by real soft-deletes, stores this format.
			deletedAt: cutoff.Format("2006-01-02 15:04:05"),
			wantNote:  false,
		},
		{
			name: "just after expiry is purged",
			// Binding time.Time is the other format used by this Go SQLite driver.
			deletedAt: cutoff.Add(-time.Second),
			wantNote:  false,
		},
	}

	noteIDs := make(map[string]int64, len(tests))
	for _, tt := range tests {
		noteID := seedNote(t, database, userID, tt.name)
		noteIDs[tt.name] = noteID
		if _, err := database.Exec(
			`INSERT INTO trash(note_id, user_id, deleted_at) VALUES(?,?,?)`,
			noteID, userID, tt.deletedAt,
		); err != nil {
			t.Fatalf("insert %s: %v", tt.name, err)
		}
	}

	repo := trash.NewRepo(database)
	if err := repo.PurgeExpired(context.Background(), now); err != nil {
		t.Fatalf("PurgeExpired: %v", err)
	}
	// Repeated runs must remain harmless.
	if err := repo.PurgeExpired(context.Background(), now); err != nil {
		t.Fatalf("second PurgeExpired: %v", err)
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var noteCount, trashCount int
			if err := database.QueryRow(`SELECT COUNT(*) FROM notes WHERE id=?`, noteIDs[tt.name]).Scan(&noteCount); err != nil {
				t.Fatalf("count note: %v", err)
			}
			if err := database.QueryRow(`SELECT COUNT(*) FROM trash WHERE note_id=?`, noteIDs[tt.name]).Scan(&trashCount); err != nil {
				t.Fatalf("count trash: %v", err)
			}
			want := 0
			if tt.wantNote {
				want = 1
			}
			if noteCount != want || trashCount != want {
				t.Fatalf("note count=%d trash count=%d; want both %d", noteCount, trashCount, want)
			}
		})
	}
}

func TestTrashRepo_PurgeExpired_RemovesRelatedRows(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	noteID := seedNote(t, database, userID, "Expired with tag")
	res, err := database.Exec(`INSERT INTO tags(user_id, name) VALUES(?,?)`, userID, "related")
	if err != nil {
		t.Fatalf("insert tag: %v", err)
	}
	tagID, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("tag id: %v", err)
	}
	if _, err := database.Exec(`INSERT INTO note_tags(note_id, tag_id) VALUES(?,?)`, noteID, tagID); err != nil {
		t.Fatalf("link tag: %v", err)
	}
	now := time.Date(2026, time.September, 18, 12, 0, 0, 0, time.UTC)
	if _, err := database.Exec(
		`INSERT INTO trash(note_id, user_id, deleted_at) VALUES(?,?,?)`,
		noteID, userID, now.Add(-7*24*time.Hour),
	); err != nil {
		t.Fatalf("insert trash: %v", err)
	}

	if err := trash.NewRepo(database).PurgeExpired(context.Background(), now); err != nil {
		t.Fatalf("PurgeExpired: %v", err)
	}

	var links int
	if err := database.QueryRow(`SELECT COUNT(*) FROM note_tags WHERE note_id=?`, noteID).Scan(&links); err != nil {
		t.Fatalf("count note tags: %v", err)
	}
	if links != 0 {
		t.Fatalf("expected related note_tags rows removed, got %d", links)
	}
}

func TestTrashRepo_PurgeExpired_PreservesActiveAndRestoredNotes(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	activeID := seedNote(t, database, userID, "Active")
	restoredID := seedNote(t, database, userID, "Restored")
	now := time.Date(2026, time.September, 18, 12, 0, 0, 0, time.UTC)
	if _, err := database.Exec(
		`INSERT INTO trash(note_id, user_id, deleted_at) VALUES(?,?,?)`,
		restoredID, userID, now.Add(-8*24*time.Hour),
	); err != nil {
		t.Fatalf("insert trash: %v", err)
	}
	repo := trash.NewRepo(database)
	if err := repo.Restore(context.Background(), restoredID, userID); err != nil {
		t.Fatalf("restore: %v", err)
	}

	if err := repo.PurgeExpired(context.Background(), now); err != nil {
		t.Fatalf("PurgeExpired: %v", err)
	}

	for _, noteID := range []int64{activeID, restoredID} {
		var count int
		if err := database.QueryRow(`SELECT COUNT(*) FROM notes WHERE id=?`, noteID).Scan(&count); err != nil {
			t.Fatalf("count note %d: %v", noteID, err)
		}
		if count != 1 {
			t.Fatalf("active/restored note %d was removed", noteID)
		}
	}
}
