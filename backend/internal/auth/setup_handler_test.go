package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
)

func newSetupFixture(t *testing.T) (*auth.SetupHandler, *auth.Service, *auth.UserRepo) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	users := auth.NewUserRepo(database)
	invites := auth.NewInviteRepo(database)
	sessions := auth.NewSessionRepo(database)
	svc := auth.NewServiceWithInvites(users, sessions, invites, 7*24*time.Hour)
	return auth.NewSetupHandler(svc), svc, users
}

func TestSetupHandler_Get_ReturnsUsernameForValidToken(t *testing.T) {
	h, svc, users := newSetupFixture(t)
	ctx := context.Background()

	u := createUser(t, users, "alice", "throwaway-dummy", false)
	rawToken, _, _ := svc.CreateInvite(ctx, u.ID, time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/api/setup/"+rawToken, nil)
	req.SetPathValue("token", rawToken)
	w := httptest.NewRecorder()
	h.Get(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp) //nolint:errcheck
	if resp["username"] != "alice" {
		t.Fatalf("unexpected username: %v", resp["username"])
	}
}

func TestSetupHandler_Get_UnknownToken_Returns404(t *testing.T) {
	h, _, _ := newSetupFixture(t)

	req := httptest.NewRequest(http.MethodGet, "/api/setup/not-real", nil)
	req.SetPathValue("token", "not-real")
	w := httptest.NewRecorder()
	h.Get(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestSetupHandler_Get_ExpiredToken_Returns404(t *testing.T) {
	h, svc, users := newSetupFixture(t)
	ctx := context.Background()

	u := createUser(t, users, "alice", "throwaway-dummy", false)
	rawToken, _, _ := svc.CreateInvite(ctx, u.ID, -time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/api/setup/"+rawToken, nil)
	req.SetPathValue("token", rawToken)
	w := httptest.NewRecorder()
	h.Get(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for expired token, got %d", w.Code)
	}
}

func TestSetupHandler_Complete_SetsPasswordAndConsumesToken(t *testing.T) {
	h, svc, users := newSetupFixture(t)
	ctx := context.Background()

	u := createUser(t, users, "alice", "throwaway-dummy", false)
	rawToken, _, _ := svc.CreateInvite(ctx, u.ID, time.Hour)

	body := `{"password":"brand-new-password-abc"}`
	req := httptest.NewRequest(http.MethodPost, "/api/setup/"+rawToken,
		bytes.NewBufferString(body))
	req.SetPathValue("token", rawToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Complete(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// New password must work.
	if _, err := svc.Login(ctx, "alice", "brand-new-password-abc"); err != nil {
		t.Fatalf("expected new password to work, got %v", err)
	}

	// Reusing the same token must fail.
	req2 := httptest.NewRequest(http.MethodPost, "/api/setup/"+rawToken,
		bytes.NewBufferString(`{"password":"another-pw-xyz-123"}`))
	req2.SetPathValue("token", rawToken)
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	h.Complete(w2, req2)
	if w2.Code != http.StatusNotFound {
		t.Fatalf("expected 404 on reuse, got %d", w2.Code)
	}
}

func TestSetupHandler_Complete_RejectsShortPassword(t *testing.T) {
	h, svc, users := newSetupFixture(t)
	ctx := context.Background()

	u := createUser(t, users, "alice", "throwaway-dummy", false)
	rawToken, _, _ := svc.CreateInvite(ctx, u.ID, time.Hour)

	body := `{"password":"short"}`
	req := httptest.NewRequest(http.MethodPost, "/api/setup/"+rawToken,
		bytes.NewBufferString(body))
	req.SetPathValue("token", rawToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Complete(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// Ensure an invalid token path does not leak any user data.
func TestSetupHandler_Complete_UnknownToken_Returns404(t *testing.T) {
	h, _, _ := newSetupFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/setup/bogus",
		bytes.NewBufferString(`{"password":"brand-new-password-abc"}`))
	req.SetPathValue("token", "bogus")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Complete(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

var _ = fmt.Sprintf // keep fmt import used across test-only helpers
