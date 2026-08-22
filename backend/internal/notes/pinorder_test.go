package notes_test

import (
	"context"
	"testing"

	"github.com/danpicton/crapnote/internal/notes"
)

// ids returns the note IDs of a listing, in order.
func ids(list []*notes.Note) []int64 {
	out := make([]int64, len(list))
	for i, n := range list {
		out[i] = n.ID
	}
	return out
}

func equalIDs(got []int64, want ...int64) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// seedPinned creates n notes and pins them all, returning them oldest-first.
func seedPinned(t *testing.T, repo *notes.Repo, userID int64, titles ...string) []*notes.Note {
	t.Helper()
	ctx := context.Background()
	out := make([]*notes.Note, 0, len(titles))
	for _, title := range titles {
		n, err := repo.Create(ctx, userID, title, "")
		if err != nil {
			t.Fatalf("create %s: %v", title, err)
		}
		if err := repo.SetPinned(ctx, n.ID, userID, true); err != nil {
			t.Fatalf("pin %s: %v", title, err)
		}
		out = append(out, n)
	}
	return out
}

func TestNoteRepo_NewlyPinnedNoteGoesToTheTop(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	pinned := seedPinned(t, repo, userID, "first", "second", "third")

	list, err := repo.List(ctx, userID, notes.ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	// Most recently pinned first — the order pinning has always produced.
	if !equalIDs(ids(list), pinned[2].ID, pinned[1].ID, pinned[0].ID) {
		t.Fatalf("got %v, want newest pin first", ids(list))
	}
}

func TestNoteRepo_ReorderPinsSetsExplicitOrder(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	pinned := seedPinned(t, repo, userID, "a", "b", "c")
	want := []int64{pinned[1].ID, pinned[2].ID, pinned[0].ID}

	if err := repo.ReorderPins(ctx, userID, want); err != nil {
		t.Fatalf("reorder: %v", err)
	}

	list, err := repo.List(ctx, userID, notes.ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if !equalIDs(ids(list), want...) {
		t.Fatalf("got %v, want %v", ids(list), want)
	}
}

func TestNoteRepo_ReorderPinsLeavesUpdatedAtAlone(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	pinned := seedPinned(t, repo, userID, "a", "b")
	before := pinned[0].UpdatedAt

	if err := repo.ReorderPins(ctx, userID, []int64{pinned[1].ID, pinned[0].ID}); err != nil {
		t.Fatalf("reorder: %v", err)
	}

	got, err := repo.Get(ctx, pinned[0].ID, userID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	// Reordering is not a content edit; bumping updated_at would reshuffle the
	// note among the unpinned ones the moment it is unpinned.
	if !got.UpdatedAt.Equal(before) {
		t.Fatalf("updated_at changed: %v -> %v", before, got.UpdatedAt)
	}
}

func TestNoteRepo_UnpinningClearsPinOrder(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	pinned := seedPinned(t, repo, userID, "a", "b", "c")
	if err := repo.ReorderPins(ctx, userID, []int64{pinned[2].ID, pinned[1].ID, pinned[0].ID}); err != nil {
		t.Fatalf("reorder: %v", err)
	}
	// "c" was dragged to the top; unpinning must not leave it sorting oddly
	// among the unpinned notes, which order purely by updated_at.
	if err := repo.SetPinned(ctx, pinned[2].ID, userID, false); err != nil {
		t.Fatalf("unpin: %v", err)
	}

	list, err := repo.List(ctx, userID, notes.ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if !equalIDs(ids(list), pinned[1].ID, pinned[0].ID, pinned[2].ID) {
		t.Fatalf("got %v, want the unpinned note last", ids(list))
	}
}

func TestNoteRepo_ReorderPinsIgnoresForeignAndUnpinnedIDs(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	pinned := seedPinned(t, repo, userID, "a", "b")
	plain, err := repo.Create(ctx, userID, "unpinned", "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	err = repo.ReorderPins(ctx, userID, []int64{pinned[1].ID, 99999, plain.ID, pinned[0].ID})
	if err != nil {
		t.Fatalf("reorder: %v", err)
	}

	list, err := repo.List(ctx, userID, notes.ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if !equalIDs(ids(list), pinned[1].ID, pinned[0].ID, plain.ID) {
		t.Fatalf("got %v, want the pinned pair reordered and the plain note last", ids(list))
	}
	// The unpinned note must not have been given a pin position.
	if got, _ := repo.Get(ctx, plain.ID, userID); got.PinOrder != 0 {
		t.Fatalf("unpinned note got pin_order %d, want 0", got.PinOrder)
	}
}

func TestNoteRepo_ReorderPinsIsScopedToTheOwner(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)
	ctx := context.Background()

	res, err := database.Exec(
		`INSERT INTO users(username, password_hash) VALUES(?, ?)`, "other", "$2a$12$fakehash")
	if err != nil {
		t.Fatalf("seed other user: %v", err)
	}
	otherID, _ := res.LastInsertId()

	mine := seedPinned(t, repo, userID, "mine-a", "mine-b")
	theirs := seedPinned(t, repo, otherID, "theirs-a", "theirs-b")

	if err := repo.ReorderPins(ctx, userID, []int64{theirs[0].ID, mine[0].ID, mine[1].ID}); err != nil {
		t.Fatalf("reorder: %v", err)
	}

	list, err := repo.List(ctx, otherID, notes.ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if !equalIDs(ids(list), theirs[1].ID, theirs[0].ID) {
		t.Fatalf("other user's order changed: %v", ids(list))
	}
}

func TestNoteRepo_ReorderPinsAcceptsAnEmptyList(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := notes.NewRepo(database)

	if err := repo.ReorderPins(context.Background(), userID, nil); err != nil {
		t.Fatalf("reorder: %v", err)
	}
}
