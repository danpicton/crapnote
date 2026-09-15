package tags_test

import (
	"context"
	"testing"

	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/requestctx"
	"github.com/danpicton/crapnote/internal/tags"
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
	res, err := database.Exec(
		`INSERT INTO users(username, password_hash) VALUES(?, ?)`, "u", "h",
	)
	if err != nil {
		t.Fatalf("seedUser: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func seedNote(t *testing.T, database *db.DB, userID int64, title string) int64 {
	t.Helper()
	res, err := database.Exec(
		`INSERT INTO notes(user_id, title, body) VALUES(?, ?, ?)`, userID, title, "",
	)
	if err != nil {
		t.Fatalf("seedNote: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func TestTagRepo_CreateAndList(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := tags.NewRepo(database)
	ctx := context.Background()

	tag, err := repo.Create(ctx, userID, "work")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if tag.ID == 0 || tag.Name != "work" || tag.UserID != userID {
		t.Fatalf("unexpected tag: %+v", tag)
	}

	list, err := repo.List(ctx, userID, 0, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 || list[0].Name != "work" {
		t.Fatalf("unexpected list: %+v", list)
	}
}

func TestTagRepo_List_NoteCount(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := tags.NewRepo(database)
	ctx := context.Background()

	tag, _ := repo.Create(ctx, userID, "go")
	n1 := seedNote(t, database, userID, "N1")
	n2 := seedNote(t, database, userID, "N2")
	repo.AddToNote(ctx, n1, tag.ID, userID) //nolint:errcheck
	repo.AddToNote(ctx, n2, tag.ID, userID) //nolint:errcheck

	list, _ := repo.List(ctx, userID, 0, 0)
	if list[0].NoteCount != 2 {
		t.Fatalf("expected NoteCount=2, got %d", list[0].NoteCount)
	}
}

func TestTagRepo_MCPDoesNotDiscloseOrMutatePrivateAssociations(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := tags.NewRepo(database)
	ctx := context.Background()
	publicTag, _ := repo.Create(ctx, userID, "public-tag")
	secretTag, _ := repo.Create(ctx, userID, "secret-tag")
	publicID := seedNote(t, database, userID, "public")
	privateID := seedNote(t, database, userID, "private")
	_, _ = database.Exec(`UPDATE notes SET private=1 WHERE id=?`, privateID)
	_ = repo.AddToNote(ctx, publicID, publicTag.ID, userID)
	_ = repo.AddToNote(ctx, privateID, secretTag.ID, userID)
	mcpCtx := requestctx.WithMCP(ctx)

	listed, err := repo.List(mcpCtx, userID, 0, 0)
	if err != nil || len(listed) != 1 || listed[0].Name != "public-tag" || listed[0].NoteCount != 1 {
		t.Fatalf("MCP tags list = %#v, %v", listed, err)
	}
	if got, err := repo.ListForNote(mcpCtx, privateID, userID); err != nil || len(got) != 0 {
		t.Fatalf("MCP private note tags = %#v, %v", got, err)
	}
	if err := repo.AddToNote(mcpCtx, privateID, publicTag.ID, userID); err != tags.ErrNotFound {
		t.Fatalf("MCP add tag to private note = %v", err)
	}
	if err := repo.AddToNote(mcpCtx, publicID, secretTag.ID, userID); err != tags.ErrNotFound {
		t.Fatalf("MCP add private-only tag to public note = %v", err)
	}
	if err := repo.RemoveFromNote(mcpCtx, privateID, secretTag.ID, userID); err != tags.ErrNotFound {
		t.Fatalf("MCP remove tag from private note = %v", err)
	}
	if _, err := repo.Rename(mcpCtx, secretTag.ID, userID, "leaked"); err != tags.ErrNotFound {
		t.Fatalf("MCP rename private-only tag = %v", err)
	}
	if err := repo.Delete(mcpCtx, secretTag.ID, userID); err != tags.ErrNotFound {
		t.Fatalf("MCP delete private-only tag = %v", err)
	}
}

func TestTagRepo_FindByID(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := tags.NewRepo(database)
	ctx := context.Background()

	tag, _ := repo.Create(ctx, userID, "reading")

	got, err := repo.FindByID(ctx, tag.ID, userID)
	if err != nil || got.Name != "reading" {
		t.Fatalf("FindByID: %v / %+v", err, got)
	}

	_, err = repo.FindByID(ctx, tag.ID, userID+999)
	if err != tags.ErrNotFound {
		t.Fatalf("expected ErrNotFound for wrong user, got %v", err)
	}
}

func TestTagRepo_Rename(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := tags.NewRepo(database)
	ctx := context.Background()

	tag, _ := repo.Create(ctx, userID, "old")
	renamed, err := repo.Rename(ctx, tag.ID, userID, "new")
	if err != nil || renamed.Name != "new" {
		t.Fatalf("Rename: %v / %+v", err, renamed)
	}
}

func TestTagRepo_Rename_WrongUser(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := tags.NewRepo(database)
	ctx := context.Background()

	tag, _ := repo.Create(ctx, userID, "mine")
	_, err := repo.Rename(ctx, tag.ID, userID+1, "stolen")
	if err != tags.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestTagRepo_Delete(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := tags.NewRepo(database)
	ctx := context.Background()

	noteID := seedNote(t, database, userID, "N")
	tag, _ := repo.Create(ctx, userID, "temp")
	repo.AddToNote(ctx, noteID, tag.ID, userID) //nolint:errcheck

	if err := repo.Delete(ctx, tag.ID, userID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Tag gone.
	_, err := repo.FindByID(ctx, tag.ID, userID)
	if err != tags.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	// note_tags association also gone (cascade).
	tagList, _ := repo.ListForNote(ctx, noteID, userID)
	if len(tagList) != 0 {
		t.Fatal("expected no tags on note after tag deletion")
	}
}

func TestTagRepo_AddRemoveFromNote(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := tags.NewRepo(database)
	ctx := context.Background()

	noteID := seedNote(t, database, userID, "Note")
	tag, _ := repo.Create(ctx, userID, "label")

	if err := repo.AddToNote(ctx, noteID, tag.ID, userID); err != nil {
		t.Fatalf("AddToNote: %v", err)
	}

	list, err := repo.ListForNote(ctx, noteID, userID)
	if err != nil || len(list) != 1 || list[0].ID != tag.ID {
		t.Fatalf("ListForNote after add: %v / %+v", err, list)
	}

	if err := repo.RemoveFromNote(ctx, noteID, tag.ID, userID); err != nil {
		t.Fatalf("RemoveFromNote: %v", err)
	}

	list, _ = repo.ListForNote(ctx, noteID, userID)
	if len(list) != 0 {
		t.Fatal("expected 0 tags after remove")
	}
}

func TestTagRepo_AssociationMutationsRemainIdempotent(t *testing.T) {
	for _, origin := range []string{"REST", "MCP"} {
		t.Run(origin, func(t *testing.T) {
			database := openTestDB(t)
			userID := seedUser(t, database)
			noteID := seedNote(t, database, userID, "Note")
			repo := tags.NewRepo(database)
			ctx := context.Background()
			if origin == "MCP" {
				ctx = requestctx.WithMCP(ctx)
			}
			tag, err := repo.Create(ctx, userID, "label")
			if err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := repo.AddToNote(ctx, noteID, tag.ID, userID); err != nil {
					t.Fatal(err)
				}
			}
			list, err := repo.ListForNote(ctx, noteID, userID)
			if err != nil || len(list) != 1 {
				t.Fatalf("repeated add: %v, %v", list, err)
			}
			for range 2 {
				if err := repo.RemoveFromNote(ctx, noteID, tag.ID, userID); err != nil {
					t.Fatal(err)
				}
			}
			list, err = repo.ListForNote(ctx, noteID, userID)
			if err != nil || len(list) != 0 {
				t.Fatalf("repeated remove: %v, %v", list, err)
			}
			// Missing/inaccessible notes aren't successful no-op removals.
			if err := repo.RemoveFromNote(ctx, noteID, tag.ID, userID+999); err != tags.ErrNotFound {
				t.Fatalf("foreign note removal: %v", err)
			}
			if err := repo.RemoveFromNote(ctx, noteID+999, tag.ID, userID); err != tags.ErrNotFound {
				t.Fatalf("missing note removal: %v", err)
			}
			if err := repo.AddToNote(ctx, noteID, tag.ID+999, userID); err != tags.ErrNotFound {
				t.Fatalf("missing tag addition: %v", err)
			}

			// The tag, not just the target note, must belong to this user.
			res, err := database.Exec(`INSERT INTO users(username,password_hash) VALUES('other','h')`)
			if err != nil {
				t.Fatal(err)
			}
			otherID, err := res.LastInsertId()
			if err != nil {
				t.Fatal(err)
			}
			foreignTag, err := repo.Create(context.Background(), otherID, "foreign")
			if err != nil {
				t.Fatal(err)
			}
			if err := repo.AddToNote(ctx, noteID, foreignTag.ID, userID); err != tags.ErrNotFound {
				t.Fatalf("foreign tag addition: %v", err)
			}
		})
	}
}

func TestTagRepo_AddToNote_WrongUser(t *testing.T) {
	database := openTestDB(t)
	userID := seedUser(t, database)
	repo := tags.NewRepo(database)
	ctx := context.Background()

	noteID := seedNote(t, database, userID, "N")
	tag, _ := repo.Create(ctx, userID, "t")

	// Tag belongs to userID but note ownership check uses userID+1.
	err := repo.AddToNote(ctx, noteID, tag.ID, userID+1)
	if err != tags.ErrNotFound {
		t.Fatalf("expected ErrNotFound for wrong user, got %v", err)
	}
}
