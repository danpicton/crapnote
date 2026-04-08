package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
)

// openTestDB opens an in-memory SQLite database with all migrations applied.
func openTestDB(t *testing.T) *db.DB {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("openTestDB: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// ── User repository ──────────────────────────────────────────────────────────

func TestUserRepo_CreateAndFind(t *testing.T) {
	repo := auth.NewUserRepo(openTestDB(t))
	ctx := context.Background()

	u, err := repo.Create(ctx, "alice", "$2a$12$hash", true)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if u.ID == 0 {
		t.Fatal("expected non-zero ID")
	}
	if u.Username != "alice" {
		t.Fatalf("expected username alice, got %q", u.Username)
	}
	if !u.IsAdmin {
		t.Fatal("expected is_admin=true")
	}

	got, err := repo.FindByUsername(ctx, "alice")
	if err != nil {
		t.Fatalf("FindByUsername: %v", err)
	}
	if got.ID != u.ID {
		t.Fatalf("ID mismatch: %d != %d", got.ID, u.ID)
	}

	got2, err := repo.FindByID(ctx, u.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got2.Username != "alice" {
		t.Fatalf("FindByID username mismatch")
	}
}

func TestUserRepo_FindByUsername_NotFound(t *testing.T) {
	repo := auth.NewUserRepo(openTestDB(t))
	_, err := repo.FindByUsername(context.Background(), "nobody")
	if err != auth.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestUserRepo_Count(t *testing.T) {
	repo := auth.NewUserRepo(openTestDB(t))
	ctx := context.Background()

	n, err := repo.Count(ctx)
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected 0, got %d", n)
	}

	repo.Create(ctx, "bob", "hash", false) //nolint:errcheck
	n, err = repo.Count(ctx)
	if err != nil {
		t.Fatalf("Count after create: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1, got %d", n)
	}
}

// ── Session repository ───────────────────────────────────────────────────────

func TestSessionRepo_CreateAndFind(t *testing.T) {
	database := openTestDB(t)
	userRepo := auth.NewUserRepo(database)
	sessRepo := auth.NewSessionRepo(database)
	ctx := context.Background()

	u, _ := userRepo.Create(ctx, "carol", "hash", false)

	exp := time.Now().Add(7 * 24 * time.Hour).UTC().Truncate(time.Second)
	sess, err := sessRepo.Create(ctx, u.ID, exp)
	if err != nil {
		t.Fatalf("Create session: %v", err)
	}
	if sess.ID == "" {
		t.Fatal("expected non-empty session ID")
	}

	got, err := sessRepo.Find(ctx, sess.ID)
	if err != nil {
		t.Fatalf("Find session: %v", err)
	}
	if got.UserID != u.ID {
		t.Fatalf("UserID mismatch: %d != %d", got.UserID, u.ID)
	}
}

func TestSessionRepo_Find_NotFound(t *testing.T) {
	sessRepo := auth.NewSessionRepo(openTestDB(t))
	_, err := sessRepo.Find(context.Background(), "nonexistent")
	if err != auth.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestSessionRepo_Delete(t *testing.T) {
	database := openTestDB(t)
	userRepo := auth.NewUserRepo(database)
	sessRepo := auth.NewSessionRepo(database)
	ctx := context.Background()

	u, _ := userRepo.Create(ctx, "dave", "hash", false)
	sess, _ := sessRepo.Create(ctx, u.ID, time.Now().Add(time.Hour).UTC())

	if err := sessRepo.Delete(ctx, sess.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	_, err := sessRepo.Find(ctx, sess.ID)
	if err != auth.ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestSessionRepo_DeleteExpired(t *testing.T) {
	database := openTestDB(t)
	userRepo := auth.NewUserRepo(database)
	sessRepo := auth.NewSessionRepo(database)
	ctx := context.Background()

	u, _ := userRepo.Create(ctx, "eve", "hash", false)
	past := time.Now().Add(-time.Hour).UTC()
	future := time.Now().Add(time.Hour).UTC()

	expired, _ := sessRepo.Create(ctx, u.ID, past)
	active, _ := sessRepo.Create(ctx, u.ID, future)

	if err := sessRepo.DeleteExpired(ctx); err != nil {
		t.Fatalf("DeleteExpired: %v", err)
	}

	if _, err := sessRepo.Find(ctx, expired.ID); err != auth.ErrNotFound {
		t.Fatal("expected expired session to be gone")
	}
	if _, err := sessRepo.Find(ctx, active.ID); err != nil {
		t.Fatalf("expected active session to remain, got %v", err)
	}
}
