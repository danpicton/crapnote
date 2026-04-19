package tokens_test

import (
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/tokens"
)

type repoFixture struct {
	database *db.DB
	repo     *tokens.Repo
	users    *auth.UserRepo
	user     *auth.User
}

func newRepoFixture(t *testing.T) *repoFixture {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	users := auth.NewUserRepo(database)
	u, err := users.Create(t.Context(), "alice", "hash", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return &repoFixture{
		database: database,
		repo:     tokens.NewRepo(database),
		users:    users,
		user:     u,
	}
}

func TestRepo_CreateAndFindByHash(t *testing.T) {
	f := newRepoFixture(t)

	exp := time.Now().Add(90 * 24 * time.Hour).UTC().Truncate(time.Second)
	tok, err := f.repo.Create(t.Context(), f.user.ID, "laptop", "hash-abc", "cnp_abc1", tokens.ScopeReadWrite, &exp)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if tok.ID == 0 {
		t.Fatal("expected non-zero id")
	}
	if tok.Name != "laptop" || tok.TokenHash != "hash-abc" {
		t.Fatalf("unexpected token: %+v", tok)
	}
	if tok.Scope != tokens.ScopeReadWrite {
		t.Fatalf("expected scope read_write, got %q", tok.Scope)
	}
	if tok.ExpiresAt == nil || !tok.ExpiresAt.Equal(exp) {
		t.Fatalf("expected expires_at %v, got %v", exp, tok.ExpiresAt)
	}
	if tok.RevokedAt != nil {
		t.Fatalf("expected no revoked_at, got %v", tok.RevokedAt)
	}

	got, err := f.repo.FindByHash(t.Context(), "hash-abc")
	if err != nil {
		t.Fatalf("find by hash: %v", err)
	}
	if got.ID != tok.ID {
		t.Fatalf("expected id %d, got %d", tok.ID, got.ID)
	}
}

func TestRepo_FindByHash_NotFound(t *testing.T) {
	f := newRepoFixture(t)
	_, err := f.repo.FindByHash(t.Context(), "does-not-exist")
	if err != tokens.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestRepo_ListByUser_OrdersNewestFirst(t *testing.T) {
	f := newRepoFixture(t)

	first, err := f.repo.Create(t.Context(), f.user.ID, "first", "h1", "cnp_1", tokens.ScopeRead, nil)
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	time.Sleep(1100 * time.Millisecond) // created_at has 1-second resolution
	second, err := f.repo.Create(t.Context(), f.user.ID, "second", "h2", "cnp_2", tokens.ScopeRead, nil)
	if err != nil {
		t.Fatalf("create second: %v", err)
	}

	list, err := f.repo.ListByUser(t.Context(), f.user.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 tokens, got %d", len(list))
	}
	if list[0].ID != second.ID || list[1].ID != first.ID {
		t.Fatalf("expected newest first: got ids %d,%d", list[0].ID, list[1].ID)
	}
}

func TestRepo_ListByUser_ScopedToUser(t *testing.T) {
	f := newRepoFixture(t)

	other, err := f.users.Create(t.Context(), "bob", "hash", false)
	if err != nil {
		t.Fatalf("create other: %v", err)
	}
	if _, err := f.repo.Create(t.Context(), f.user.ID, "mine", "h-mine", "cnp_me", tokens.ScopeRead, nil); err != nil {
		t.Fatalf("create mine: %v", err)
	}
	if _, err := f.repo.Create(t.Context(), other.ID, "theirs", "h-theirs", "cnp_ot", tokens.ScopeRead, nil); err != nil {
		t.Fatalf("create theirs: %v", err)
	}

	mine, err := f.repo.ListByUser(t.Context(), f.user.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(mine) != 1 || mine[0].Name != "mine" {
		t.Fatalf("unexpected list: %+v", mine)
	}
}

func TestRepo_Revoke_SetsTimestamp(t *testing.T) {
	f := newRepoFixture(t)
	tok, err := f.repo.Create(t.Context(), f.user.ID, "t", "h", "cnp_xx", tokens.ScopeReadWrite, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Second)
	if err := f.repo.Revoke(t.Context(), tok.ID, now); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	got, err := f.repo.FindByID(t.Context(), tok.ID)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if got.RevokedAt == nil {
		t.Fatal("expected revoked_at to be set")
	}
	if !got.RevokedAt.Equal(now) {
		t.Fatalf("expected revoked_at %v, got %v", now, got.RevokedAt)
	}
}

func TestRepo_Revoke_NotFound(t *testing.T) {
	f := newRepoFixture(t)
	err := f.repo.Revoke(t.Context(), 99999, time.Now())
	if err != tokens.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestRepo_RevokeAllForUser(t *testing.T) {
	f := newRepoFixture(t)
	t1, _ := f.repo.Create(t.Context(), f.user.ID, "a", "ha", "cnp_a", tokens.ScopeRead, nil)
	t2, _ := f.repo.Create(t.Context(), f.user.ID, "b", "hb", "cnp_b", tokens.ScopeRead, nil)

	if err := f.repo.RevokeAllForUser(t.Context(), f.user.ID, time.Now().UTC()); err != nil {
		t.Fatalf("revoke all: %v", err)
	}

	for _, id := range []int64{t1.ID, t2.ID} {
		got, err := f.repo.FindByID(t.Context(), id)
		if err != nil {
			t.Fatalf("find %d: %v", id, err)
		}
		if got.RevokedAt == nil {
			t.Fatalf("token %d: expected revoked_at set", id)
		}
	}
}

func TestRepo_UpdateLastUsed(t *testing.T) {
	f := newRepoFixture(t)
	tok, _ := f.repo.Create(t.Context(), f.user.ID, "t", "h", "cnp_xx", tokens.ScopeRead, nil)

	ts := time.Now().UTC().Truncate(time.Second)
	if err := f.repo.UpdateLastUsed(t.Context(), tok.ID, ts); err != nil {
		t.Fatalf("update last used: %v", err)
	}

	got, err := f.repo.FindByID(t.Context(), tok.ID)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if got.LastUsedAt == nil || !got.LastUsedAt.Equal(ts) {
		t.Fatalf("expected last_used_at %v, got %v", ts, got.LastUsedAt)
	}
}
