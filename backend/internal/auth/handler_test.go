package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/httpx"
)

func newTestHandler(t *testing.T) (*auth.Handler, *auth.Service) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	svc := auth.NewService(
		auth.NewUserRepo(database),
		auth.NewSessionRepo(database),
		7*24*time.Hour,
	)
	return auth.NewHandler(svc), svc
}

func newTestHandlerWithRepo(t *testing.T) (*auth.Handler, *auth.Service, *auth.UserRepo) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	users := auth.NewUserRepo(database)
	svc := auth.NewService(users, auth.NewSessionRepo(database), 7*24*time.Hour)
	return auth.NewHandler(svc), svc, users
}

func TestHandler_Login_Success(t *testing.T) {
	h, svc := newTestHandler(t)
	svc.SeedAdmin(t.Context(), "admin", "pass") //nolint:errcheck

	body := `{"username":"admin","password":"pass"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Login(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	cookies := w.Result().Cookies()
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Fatal("expected session cookie")
	}
	if !sessionCookie.HttpOnly {
		t.Fatal("session cookie must be HttpOnly")
	}

	// The body must include the user object so the SPA can populate its
	// auth store on first paint without an extra /api/auth/me round-trip;
	// admin-only UI was hidden until refresh before this was added.
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["username"] != "admin" {
		t.Fatalf("expected username=admin in response, got %v", resp["username"])
	}
	if resp["is_admin"] != true {
		t.Fatalf("expected is_admin=true in response, got %v (resp=%v)", resp["is_admin"], resp)
	}
}

// Cookie Secure flag must follow the transport, not be hardcoded to true.
// Hardcoding Secure:true breaks HTTP deployments because browsers silently
// discard the cookie on every subsequent request, making the session useless.

func TestHandler_Login_Cookie_NotSecure_OverHTTP(t *testing.T) {
	h, svc := newTestHandler(t)
	svc.SeedAdmin(t.Context(), "admin", "pass") //nolint:errcheck

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"username":"admin","password":"pass"}`))
	// Plain HTTP request: r.TLS is nil, no X-Forwarded-Proto header
	w := httptest.NewRecorder()
	h.Login(w, req)

	cookie := findCookie(t, w.Result(), "session")
	if cookie.Secure {
		t.Fatal("session cookie must NOT be Secure over plain HTTP — browser will discard it")
	}
}

func TestHandler_Login_Cookie_Secure_WhenTrustedProxySignalsHTTPS(t *testing.T) {
	h, svc := newTestHandler(t)
	svc.SeedAdmin(t.Context(), "admin", "pass") //nolint:errcheck

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"username":"admin","password":"pass"}`))
	req.Header.Set("X-Forwarded-Proto", "https") // reverse proxy signals HTTPS
	w := httptest.NewRecorder()
	httpx.TrustProxy()(http.HandlerFunc(h.Login)).ServeHTTP(w, req)

	cookie := findCookie(t, w.Result(), "session")
	if !cookie.Secure {
		t.Fatal("session cookie must be Secure when behind a trusted HTTPS reverse proxy")
	}
}

func TestHandler_Login_Cookie_IgnoresForwardedProtoWithoutTrust(t *testing.T) {
	h, svc := newTestHandler(t)
	svc.SeedAdmin(t.Context(), "admin", "pass") //nolint:errcheck

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"username":"admin","password":"pass"}`))
	// Client-supplied header with no trusted proxy configured: it must not
	// influence the Secure flag.
	req.Header.Set("X-Forwarded-Proto", "https")
	w := httptest.NewRecorder()
	h.Login(w, req)

	cookie := findCookie(t, w.Result(), "session")
	if cookie.Secure {
		t.Fatal("X-Forwarded-Proto must be ignored when no trusted proxy is configured")
	}
}

func TestHandler_Logout_Cookie_MatchesTransport(t *testing.T) {
	h, svc := newTestHandler(t)
	svc.SeedAdmin(t.Context(), "admin", "pass") //nolint:errcheck
	sess, _ := svc.Login(t.Context(), "admin", "pass")

	// Over plain HTTP the cleared cookie should also not be Secure
	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sess.ID})
	w := httptest.NewRecorder()
	h.Logout(w, req)

	cookie := findCookie(t, w.Result(), "session")
	if cookie.Secure {
		t.Fatal("logout cookie must NOT be Secure over plain HTTP")
	}
}

// findCookie is a test helper that fails if the named cookie is absent.
func findCookie(t *testing.T, resp *http.Response, name string) *http.Cookie {
	t.Helper()
	for _, c := range resp.Cookies() {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("cookie %q not found in response", name)
	return nil
}

func TestHandler_Login_BadCredentials(t *testing.T) {
	h, svc := newTestHandler(t)
	svc.SeedAdmin(t.Context(), "admin", "correct") //nolint:errcheck

	body := `{"username":"admin","password":"wrong"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Login(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_Login_LockedAccount_Returns403(t *testing.T) {
	h, svc, users := newTestHandlerWithRepo(t)
	createUser(t, users, "alice", "correctpass", false)

	// Enough failed attempts → locked.
	for i := 0; i < auth.DefaultMaxFailedLoginAttempts; i++ {
		svc.Login(t.Context(), "alice", "wrong") //nolint:errcheck
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		bytes.NewBufferString(`{"username":"alice","password":"correctpass"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Login(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for locked account, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_Me(t *testing.T) {
	h, svc := newTestHandler(t)
	svc.SeedAdmin(t.Context(), "admin", "pass") //nolint:errcheck

	sess, _ := svc.Login(t.Context(), "admin", "pass")
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sess.ID})

	// Me requires the user to be in context — middleware sets it. Test directly
	// by injecting the user.
	user, _ := svc.ValidateSession(t.Context(), sess.ID)
	req = req.WithContext(auth.WithUser(req.Context(), user))

	w := httptest.NewRecorder()
	h.Me(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["username"] != "admin" {
		t.Fatalf("expected username admin, got %v", resp["username"])
	}
	if _, ok := resp["api_tokens_enabled"]; !ok {
		t.Fatalf("expected api_tokens_enabled in response, got %v", resp)
	}
}

func TestHandler_ChangePassword_Success(t *testing.T) {
	h, svc, users := newTestHandlerWithRepo(t)
	u := createUser(t, users, "alice", "currentpass123", false)

	body := `{"new_password":"brandnewpass456"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/password", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithUser(req.Context(), u))
	w := httptest.NewRecorder()
	h.ChangePassword(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// New password works.
	if _, err := svc.Login(t.Context(), "alice", "brandnewpass456"); err != nil {
		t.Fatalf("new password should work: %v", err)
	}
	// Old password no longer works.
	if _, err := svc.Login(t.Context(), "alice", "currentpass123"); err != auth.ErrInvalidCredentials {
		t.Fatalf("old password should fail, got %v", err)
	}
}

// The endpoint deliberately no longer requires the current password — a
// logged-in user who has forgotten it should still be able to set a new one.
// See ChangePassword in service.go for the rationale.
func TestHandler_ChangePassword_NoCurrent_Succeeds(t *testing.T) {
	h, svc, users := newTestHandlerWithRepo(t)
	u := createUser(t, users, "alice", "currentpass123", false)

	body := `{"new_password":"brandnewpass456"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/password", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithUser(req.Context(), u))
	w := httptest.NewRecorder()
	h.ChangePassword(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}
	if _, err := svc.Login(t.Context(), "alice", "brandnewpass456"); err != nil {
		t.Fatalf("new password should work: %v", err)
	}
}

func TestHandler_ChangePassword_ShortNew_Returns400(t *testing.T) {
	h, _, users := newTestHandlerWithRepo(t)
	u := createUser(t, users, "alice", "currentpass123", false)

	body := `{"new_password":"short"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/password", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithUser(req.Context(), u))
	w := httptest.NewRecorder()
	h.ChangePassword(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandler_ChangePassword_Unauthenticated_Returns401(t *testing.T) {
	h, _, _ := newTestHandlerWithRepo(t)
	body := `{"new_password":"brandnewpass456"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/password", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ChangePassword(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_Logout(t *testing.T) {
	h, svc := newTestHandler(t)
	svc.SeedAdmin(t.Context(), "admin", "pass") //nolint:errcheck
	sess, _ := svc.Login(t.Context(), "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sess.ID})
	w := httptest.NewRecorder()
	h.Logout(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}
}
