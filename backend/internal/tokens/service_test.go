package tokens_test

import (
	"strings"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/tokens"
)

type serviceFixture struct {
	database *db.DB
	users    *auth.UserRepo
	svc      *tokens.Service
	user     *auth.User
	admin    *auth.User
}

func newServiceFixture(t *testing.T) *serviceFixture {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	users := auth.NewUserRepo(database)
	u, err := users.Create(t.Context(), "alice", "hash", false)
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	admin, err := users.Create(t.Context(), "root", "hash", true)
	if err != nil {
		t.Fatalf("create root: %v", err)
	}
	svc := tokens.NewService(tokens.NewRepo(database), users)
	return &serviceFixture{database: database, users: users, svc: svc, user: u, admin: admin}
}

func TestService_Create_NonAdmin_ForbiddenWhenFlagOff(t *testing.T) {
	f := newServiceFixture(t)
	_, err := f.svc.Create(t.Context(), f.user, "laptop", tokens.ScopeReadWrite, 0)
	if err != tokens.ErrForbidden {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestService_Create_NonAdmin_AllowedWhenFlagOn(t *testing.T) {
	f := newServiceFixture(t)
	if err := f.users.SetAPITokensEnabled(t.Context(), f.user.ID, true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	u, _ := f.users.FindByID(t.Context(), f.user.ID)
	created, err := f.svc.Create(t.Context(), u, "laptop", tokens.ScopeReadWrite, 0)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.HasPrefix(created.RawToken, tokens.TokenPrefix) {
		t.Fatalf("token missing prefix: %q", created.RawToken)
	}
	if created.Token.ExpiresAt == nil {
		t.Fatal("expected default expiry to be set")
	}
}

func TestService_Create_Admin_AlwaysAllowed(t *testing.T) {
	f := newServiceFixture(t)
	created, err := f.svc.Create(t.Context(), f.admin, "admin-cli", tokens.ScopeRead, 0)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Token.UserID != f.admin.ID {
		t.Fatalf("expected admin id %d, got %d", f.admin.ID, created.Token.UserID)
	}
}

func TestService_Create_NegativeTTL_NoExpiry(t *testing.T) {
	f := newServiceFixture(t)
	created, err := f.svc.Create(t.Context(), f.admin, "forever", tokens.ScopeRead, -1)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Token.ExpiresAt != nil {
		t.Fatalf("expected no expiry, got %v", created.Token.ExpiresAt)
	}
}

func TestService_Create_InvalidName(t *testing.T) {
	f := newServiceFixture(t)
	if _, err := f.svc.Create(t.Context(), f.admin, "", tokens.ScopeRead, 0); err != tokens.ErrInvalidName {
		t.Fatalf("empty name: expected ErrInvalidName, got %v", err)
	}
	if _, err := f.svc.Create(t.Context(), f.admin, strings.Repeat("x", tokens.MaxNameLen+1), tokens.ScopeRead, 0); err != tokens.ErrInvalidName {
		t.Fatalf("long name: expected ErrInvalidName, got %v", err)
	}
}

func TestService_Create_InvalidScope(t *testing.T) {
	f := newServiceFixture(t)
	if _, err := f.svc.Create(t.Context(), f.admin, "n", tokens.Scope("bogus"), 0); err != tokens.ErrInvalidScope {
		t.Fatalf("expected ErrInvalidScope, got %v", err)
	}
}

func TestService_Verify_RoundTrip(t *testing.T) {
	f := newServiceFixture(t)
	created, err := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeReadWrite, 0)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	v, err := f.svc.Verify(t.Context(), created.RawToken)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if v.User.ID != f.admin.ID {
		t.Fatalf("expected user %d, got %d", f.admin.ID, v.User.ID)
	}
	if v.Scope != tokens.ScopeReadWrite {
		t.Fatalf("expected scope read_write, got %q", v.Scope)
	}
	if v.TokenID != created.Token.ID {
		t.Fatalf("expected token id %d, got %d", created.Token.ID, v.TokenID)
	}
}

func TestService_Verify_RejectsMalformed(t *testing.T) {
	f := newServiceFixture(t)

	cases := []string{"", "not-a-token", "Bearer something", "cnp_"}
	for _, c := range cases {
		if _, err := f.svc.Verify(t.Context(), c); err != tokens.ErrInvalidToken {
			t.Fatalf("input %q: expected ErrInvalidToken, got %v", c, err)
		}
	}
}

func TestService_Verify_RejectsRevoked(t *testing.T) {
	f := newServiceFixture(t)
	created, _ := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeRead, 0)

	if err := f.svc.Revoke(t.Context(), f.admin.ID, created.Token.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := f.svc.Verify(t.Context(), created.RawToken); err != tokens.ErrInvalidToken {
		t.Fatalf("expected ErrInvalidToken after revoke, got %v", err)
	}
}

func TestService_Verify_RejectsExpired(t *testing.T) {
	f := newServiceFixture(t)
	// 1ms TTL then sleep to ensure expiry.
	created, err := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeRead, 1*time.Millisecond)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	time.Sleep(10 * time.Millisecond)
	if _, err := f.svc.Verify(t.Context(), created.RawToken); err != tokens.ErrInvalidToken {
		t.Fatalf("expected ErrInvalidToken after expiry, got %v", err)
	}
}

func TestService_Verify_RejectsWhenUserDisabled(t *testing.T) {
	f := newServiceFixture(t)
	if err := f.users.SetAPITokensEnabled(t.Context(), f.user.ID, true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	u, _ := f.users.FindByID(t.Context(), f.user.ID)
	created, err := f.svc.Create(t.Context(), u, "cli", tokens.ScopeRead, 0)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := f.users.SetAPITokensEnabled(t.Context(), f.user.ID, false); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if _, err := f.svc.Verify(t.Context(), created.RawToken); err != tokens.ErrInvalidToken {
		t.Fatalf("expected ErrInvalidToken after user disabled, got %v", err)
	}
}

func TestService_Verify_RejectsWhenUserLocked(t *testing.T) {
	f := newServiceFixture(t)
	if err := f.users.SetAPITokensEnabled(t.Context(), f.user.ID, true); err != nil {
		t.Fatalf("enable: %v", err)
	}
	u, _ := f.users.FindByID(t.Context(), f.user.ID)
	created, err := f.svc.Create(t.Context(), u, "cli", tokens.ScopeRead, 0)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := f.users.Lock(t.Context(), f.user.ID); err != nil {
		t.Fatalf("lock: %v", err)
	}
	if _, err := f.svc.Verify(t.Context(), created.RawToken); err != tokens.ErrInvalidToken {
		t.Fatalf("expected ErrInvalidToken for locked user, got %v", err)
	}
}

func TestService_Revoke_OtherUsersToken_ReturnsNotFound(t *testing.T) {
	f := newServiceFixture(t)
	adminTok, _ := f.svc.Create(t.Context(), f.admin, "a", tokens.ScopeRead, 0)
	// Alice tries to revoke admin's token.
	if err := f.svc.Revoke(t.Context(), f.user.ID, adminTok.Token.ID); err != tokens.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestService_RevokeAll(t *testing.T) {
	f := newServiceFixture(t)
	t1, _ := f.svc.Create(t.Context(), f.admin, "a", tokens.ScopeRead, 0)
	t2, _ := f.svc.Create(t.Context(), f.admin, "b", tokens.ScopeRead, 0)

	if err := f.svc.RevokeAll(t.Context(), f.admin.ID); err != nil {
		t.Fatalf("revoke all: %v", err)
	}
	if _, err := f.svc.Verify(t.Context(), t1.RawToken); err != tokens.ErrInvalidToken {
		t.Fatalf("t1 should be invalid")
	}
	if _, err := f.svc.Verify(t.Context(), t2.RawToken); err != tokens.ErrInvalidToken {
		t.Fatalf("t2 should be invalid")
	}
}

func TestService_List(t *testing.T) {
	f := newServiceFixture(t)
	if _, err := f.svc.Create(t.Context(), f.admin, "cli1", tokens.ScopeRead, 0); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := f.svc.Create(t.Context(), f.admin, "cli2", tokens.ScopeReadWrite, 0); err != nil {
		t.Fatalf("create: %v", err)
	}

	list, err := f.svc.List(t.Context(), f.admin.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 tokens, got %d", len(list))
	}
	for _, tok := range list {
		if tok.TokenHash == "" || tok.Prefix == "" {
			t.Fatalf("token missing hash/prefix: %+v", tok)
		}
	}
}

func TestService_CreatedToken_RawLooksSane(t *testing.T) {
	f := newServiceFixture(t)
	created, err := f.svc.Create(t.Context(), f.admin, "n", tokens.ScopeRead, 0)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// cnp_ + 43 base64url chars (32 bytes raw → 43 chars unpadded)
	if len(created.RawToken) != len(tokens.TokenPrefix)+43 {
		t.Fatalf("unexpected raw length %d: %q", len(created.RawToken), created.RawToken)
	}
	// display prefix = cnp_ + first 8 of suffix
	if len(created.Token.Prefix) != len(tokens.TokenPrefix)+tokens.DisplayPrefixLen {
		t.Fatalf("unexpected prefix %q", created.Token.Prefix)
	}
}
