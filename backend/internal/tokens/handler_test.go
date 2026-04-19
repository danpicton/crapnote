package tokens_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/tokens"
)

type handlerFixture struct {
	database *db.DB
	users    *auth.UserRepo
	svc      *tokens.Service
	handler  *tokens.Handler
	user     *auth.User
	admin    *auth.User
}

func newHandlerFixture(t *testing.T) *handlerFixture {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	users := auth.NewUserRepo(database)
	admin, _ := users.Create(t.Context(), "root", "hash", true)
	u, _ := users.Create(t.Context(), "alice", "hash", false)
	svc := tokens.NewService(tokens.NewRepo(database), users)
	return &handlerFixture{
		database: database,
		users:    users,
		svc:      svc,
		handler:  tokens.NewHandler(svc),
		user:     u,
		admin:    admin,
	}
}

func withUser(req *http.Request, u *auth.User) *http.Request {
	return req.WithContext(auth.WithUser(req.Context(), u))
}

func TestHandler_Create_ReturnsTokenOnce(t *testing.T) {
	f := newHandlerFixture(t)

	body, _ := json.Marshal(map[string]any{"name": "cli", "scope": "read_write"})
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", bytes.NewReader(body))
	req = withUser(req, f.admin)
	w := httptest.NewRecorder()
	f.handler.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	raw, _ := resp["token"].(string)
	if !strings.HasPrefix(raw, tokens.TokenPrefix) {
		t.Fatalf("expected token with prefix %q, got %q", tokens.TokenPrefix, raw)
	}
	if resp["scope"] != "read_write" {
		t.Fatalf("expected scope read_write, got %v", resp["scope"])
	}

	// Listing must not expose the raw token.
	req2 := httptest.NewRequest(http.MethodGet, "/api/tokens", nil)
	req2 = withUser(req2, f.admin)
	w2 := httptest.NewRecorder()
	f.handler.List(w2, req2)
	if strings.Contains(w2.Body.String(), raw) {
		t.Fatalf("raw token leaked in list response: %s", w2.Body.String())
	}
}

func TestHandler_Create_NonAdmin_Forbidden(t *testing.T) {
	f := newHandlerFixture(t)

	body, _ := json.Marshal(map[string]any{"name": "cli", "scope": "read"})
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", bytes.NewReader(body))
	req = withUser(req, f.user)
	w := httptest.NewRecorder()
	f.handler.Create(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_Create_BadScope_400(t *testing.T) {
	f := newHandlerFixture(t)

	body, _ := json.Marshal(map[string]any{"name": "cli", "scope": "admin"})
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", bytes.NewReader(body))
	req = withUser(req, f.admin)
	w := httptest.NewRecorder()
	f.handler.Create(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandler_Revoke_DeletesOwnToken(t *testing.T) {
	f := newHandlerFixture(t)
	created, _ := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeRead, 0)

	req := httptest.NewRequest(http.MethodDelete, "/api/tokens/{id}", nil)
	req.SetPathValue("id", formatID(created.Token.ID))
	req = withUser(req, f.admin)
	w := httptest.NewRecorder()
	f.handler.Revoke(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}
	if _, err := f.svc.Verify(t.Context(), created.RawToken); err != tokens.ErrInvalidToken {
		t.Fatal("token should be invalid after revoke")
	}
}

func TestHandler_Revoke_OtherUsersToken_404(t *testing.T) {
	f := newHandlerFixture(t)
	// Create a token for admin, try to revoke as alice (who has no tokens
	// enabled, but that's ok — she's still authenticated).
	created, _ := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeRead, 0)

	req := httptest.NewRequest(http.MethodDelete, "/api/tokens/{id}", nil)
	req.SetPathValue("id", formatID(created.Token.ID))
	req = withUser(req, f.user)
	w := httptest.NewRecorder()
	f.handler.Revoke(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestHandler_RevokeAll(t *testing.T) {
	f := newHandlerFixture(t)
	t1, _ := f.svc.Create(t.Context(), f.admin, "a", tokens.ScopeRead, 0)
	t2, _ := f.svc.Create(t.Context(), f.admin, "b", tokens.ScopeReadWrite, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/tokens/revoke-all", nil)
	req = withUser(req, f.admin)
	w := httptest.NewRecorder()
	f.handler.RevokeAll(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}
	for _, raw := range []string{t1.RawToken, t2.RawToken} {
		if _, err := f.svc.Verify(t.Context(), raw); err != tokens.ErrInvalidToken {
			t.Fatalf("expected token to be invalid after revoke-all")
		}
	}
}

func TestHandler_List_ScopedToCaller(t *testing.T) {
	f := newHandlerFixture(t)
	_, _ = f.svc.Create(t.Context(), f.admin, "mine", tokens.ScopeRead, 0)
	// Enable alice + create a token for her.
	_ = f.users.SetAPITokensEnabled(t.Context(), f.user.ID, true)
	alice, _ := f.users.FindByID(t.Context(), f.user.ID)
	_, _ = f.svc.Create(t.Context(), alice, "hers", tokens.ScopeRead, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/tokens", nil)
	req = withUser(req, f.admin)
	w := httptest.NewRecorder()
	f.handler.List(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var out []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(out) != 1 || out[0]["name"] != "mine" {
		t.Fatalf("expected only admin's token, got %v", out)
	}
}

func formatID(id int64) string {
	return strconv.FormatInt(id, 10)
}
