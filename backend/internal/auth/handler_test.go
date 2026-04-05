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
