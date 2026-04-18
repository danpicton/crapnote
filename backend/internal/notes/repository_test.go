package notes_test

import (
	"context"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/notes"
)

func strPtr(s string) *string { return &s }

func openTestDB(t *testing.T) *db.DB {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("openTestDB: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// seedUser inserts a bare user row so we can satisfy the FK constraint.
func seedUser(t *testing.T, database *db.DB) int64 {
	t.Helper()
	res, err := database.Exec(
		`INSERT INTO users(username, password_hash) VALUES(?, ?)`,
		"testuser", "$2a$12$fakehash",
	)
	if err != nil {
		t.Fatalf("seedUser: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func TestNoteRepo_CreateAndGet(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, err := repo.Create(ctx, userID, "Hello", "World body")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if note.ID == 0 {
		t.Fatal("expected non-zero ID")
	}
	if note.Title != "Hello" || note.Body != "World body" {
		t.Fatalf("unexpected note: %+v", note)
	}
	if note.UserID != userID {
		t.Fatalf("wrong UserID: %d", note.UserID)
	}
	if note.Starred || note.Pinned {
		t.Fatal("new note should not be starred or pinned")
	}

	got, err := repo.Get(ctx, note.ID, userID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ID != note.ID {
		t.Fatalf("ID mismatch")
	}
}

func TestNoteRepo_Get_WrongUser(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, _ := repo.Create(ctx, userID, "Private", "body")
	_, err := repo.Get(ctx, note.ID, userID+999)
	if err != notes.ErrNotFound {
		t.Fatalf("expected ErrNotFound for wrong user, got %v", err)
	}
}

func TestNoteRepo_List_PinnedFirst(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	n1, _ := repo.Create(ctx, userID, "First", "")
	n2, _ := repo.Create(ctx, userID, "Second", "")
	n3, _ := repo.Create(ctx, userID, "Third", "")
	repo.SetPinned(ctx, n2.ID, userID, true) //nolint:errcheck

	list, err := repo.List(ctx, userID, notes.ListFilter{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 3 {
		t.Fatalf("expected 3, got %d", len(list))
	}
	// n2 is pinned — must appear first.
	if list[0].ID != n2.ID {
		t.Fatalf("pinned note should be first, got ID %d", list[0].ID)
	}
	// Remaining should be ordered by updated_at DESC.
	if list[1].ID != n3.ID || list[2].ID != n1.ID {
		t.Fatalf("unexpected order: %d %d", list[1].ID, list[2].ID)
	}
}

func TestNoteRepo_List_FilterStarred(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	n1, _ := repo.Create(ctx, userID, "A", "")
	repo.Create(ctx, userID, "B", "") //nolint:errcheck
	repo.SetStarred(ctx, n1.ID, userID, true) //nolint:errcheck

	starred := true
	list, err := repo.List(ctx, userID, notes.ListFilter{Starred: &starred})
	if err != nil {
		t.Fatalf("List starred: %v", err)
	}
	if len(list) != 1 || list[0].ID != n1.ID {
		t.Fatalf("expected only starred note, got %v", list)
	}
}

func TestNoteRepo_Update(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, _ := repo.Create(ctx, userID, "Old", "old body")
	time.Sleep(10 * time.Millisecond) // ensure updated_at differs

	updated, err := repo.Update(ctx, note.ID, userID, strPtr("New Title"), strPtr("new body"))
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Title != "New Title" || updated.Body != "new body" {
		t.Fatalf("unexpected: %+v", updated)
	}
	if !updated.UpdatedAt.After(note.UpdatedAt) {
		t.Fatal("updated_at should advance")
	}
}

func TestNoteRepo_Update_WrongUser(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, _ := repo.Create(ctx, userID, "Mine", "")
	_, err := repo.Update(ctx, note.ID, userID+999, strPtr("Hacked"), strPtr(""))
	if err != notes.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestNoteRepo_SetStarred(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, _ := repo.Create(ctx, userID, "T", "")

	if err := repo.SetStarred(ctx, note.ID, userID, true); err != nil {
		t.Fatalf("SetStarred: %v", err)
	}
	got, _ := repo.Get(ctx, note.ID, userID)
	if !got.Starred {
		t.Fatal("expected starred=true")
	}

	repo.SetStarred(ctx, note.ID, userID, false) //nolint:errcheck
	got, _ = repo.Get(ctx, note.ID, userID)
	if got.Starred {
		t.Fatal("expected starred=false after toggle")
	}
}

func TestNoteRepo_SetPinned(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, _ := repo.Create(ctx, userID, "T", "")
	repo.SetPinned(ctx, note.ID, userID, true) //nolint:errcheck
	got, _ := repo.Get(ctx, note.ID, userID)
	if !got.Pinned {
		t.Fatal("expected pinned=true")
	}
}

func TestNoteRepo_SoftDelete(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, _ := repo.Create(ctx, userID, "ToDelete", "")

	if err := repo.SoftDelete(ctx, note.ID, userID); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}

	// Should no longer appear in normal list.
	list, _ := repo.List(ctx, userID, notes.ListFilter{})
	for _, n := range list {
		if n.ID == note.ID {
			t.Fatal("deleted note should not appear in list")
		}
	}

	// Should not be fetchable via Get.
	_, err := repo.Get(ctx, note.ID, userID)
	if err != notes.ErrNotFound {
		t.Fatalf("expected ErrNotFound for deleted note, got %v", err)
	}
}

func TestNoteRepo_Archive(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, _ := repo.Create(ctx, userID, "Archivable", "body")

	if err := repo.Archive(ctx, note.ID, userID); err != nil {
		t.Fatalf("Archive: %v", err)
	}

	// Archived note must not appear in normal list.
	list, _ := repo.List(ctx, userID, notes.ListFilter{})
	for _, n := range list {
		if n.ID == note.ID {
			t.Fatal("archived note should not appear in normal list")
		}
	}

	// Archived note must not be fetchable via Get (normal).
	_, err := repo.Get(ctx, note.ID, userID)
	if err != notes.ErrNotFound {
		t.Fatalf("expected ErrNotFound for archived note via Get, got %v", err)
	}

	// But it must appear in ListArchived.
	archived, err := repo.ListArchived(ctx, userID, 0, 0)
	if err != nil {
		t.Fatalf("ListArchived: %v", err)
	}
	found := false
	for _, n := range archived {
		if n.ID == note.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("archived note not found in ListArchived")
	}
}

func TestNoteRepo_Unarchive(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, _ := repo.Create(ctx, userID, "Restore me", "body")
	repo.Archive(ctx, note.ID, userID) //nolint:errcheck

	if err := repo.Unarchive(ctx, note.ID, userID); err != nil {
		t.Fatalf("Unarchive: %v", err)
	}

	// Must reappear in normal list.
	list, _ := repo.List(ctx, userID, notes.ListFilter{})
	found := false
	for _, n := range list {
		if n.ID == note.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("unarchived note should reappear in normal list")
	}
}

func TestNoteRepo_ListArchived_ExcludesTrashed(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	note, _ := repo.Create(ctx, userID, "Both", "")
	repo.Archive(ctx, note.ID, userID)  //nolint:errcheck
	repo.SoftDelete(ctx, note.ID, userID) //nolint:errcheck

	archived, _ := repo.ListArchived(ctx, userID, 0, 0)
	for _, n := range archived {
		if n.ID == note.ID {
			t.Fatal("trashed+archived note should not appear in ListArchived")
		}
	}
}

func TestNoteRepo_List_PrefixSearch(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	repo.Create(ctx, userID, "Elephants are large", "big body text")  //nolint:errcheck
	repo.Create(ctx, userID, "Nothing matches", "other content")       //nolint:errcheck

	// Typing the first few characters of "Elephants" should match the first note.
	results, err := repo.List(ctx, userID, notes.ListFilter{Search: "Eleph"})
	if err != nil {
		t.Fatalf("List with prefix search: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result for prefix 'Eleph', got %d", len(results))
	}
	if results[0].Title != "Elephants are large" {
		t.Fatalf("unexpected title: %s", results[0].Title)
	}

	// Single character prefix must match.
	results2, _ := repo.List(ctx, userID, notes.ListFilter{Search: "E"})
	if len(results2) != 1 {
		t.Fatalf("expected 1 result for prefix 'E', got %d", len(results2))
	}
}

func TestNoteRepo_List_SearchSpecialCharactersNoError(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	repo.Create(ctx, userID, "Hello World", "some content") //nolint:errcheck

	// FTS5 metacharacters that previously caused parse errors must not
	// propagate as errors — they should return empty results safely.
	inputs := []string{
		`(unclosed`,
		`he"llo`,
		`OR AND NOT`,
		`*star*`,
		`"already quoted"`,
		`""`,
	}
	for _, input := range inputs {
		t.Run(input, func(t *testing.T) {
			_, err := repo.List(ctx, userID, notes.ListFilter{Search: input})
			if err != nil {
				t.Errorf("List with search %q returned unexpected error: %v", input, err)
			}
		})
	}
}
