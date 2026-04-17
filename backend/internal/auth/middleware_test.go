package auth_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
)

func newMiddlewareFixture(t *testing.T) (*auth.Handler, *auth.Service) {
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

// okHandler is a sentinel next handler that writes 200.
var okHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})

func TestRequireAuth_NoCookie(t *testing.T) {
	h, _ := newMiddlewareFixture(t)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.RequireAuth(okHandler).ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestRequireAuth_InvalidSession(t *testing.T) {
	h, _ := newMiddlewareFixture(t)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: "bogus-session-token"})
	w := httptest.NewRecorder()
	h.RequireAuth(okHandler).ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid session, got %d", w.Code)
	}
}

func TestRequireAuth_ValidSession_InjectsUser(t *testing.T) {
	h, svc := newMiddlewareFixture(t)
	svc.SeedAdmin(t.Context(), "alice", "pass") //nolint:errcheck
	sess, err := svc.Login(t.Context(), "alice", "pass")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	var capturedUser *auth.User
	captureHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedUser = auth.UserFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sess.ID})
	w := httptest.NewRecorder()
	h.RequireAuth(captureHandler).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if capturedUser == nil {
		t.Fatal("expected user in context, got nil")
	}
	if capturedUser.Username != "alice" {
		t.Fatalf("expected username alice, got %q", capturedUser.Username)
	}
}

func TestRequireAdmin_NoUser(t *testing.T) {
	h, _ := newMiddlewareFixture(t)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	// No user in context
	w := httptest.NewRecorder()
	h.RequireAdmin(okHandler).ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestRequireAdmin_NonAdmin(t *testing.T) {
	h, _ := newMiddlewareFixture(t)

	nonAdmin := &auth.User{ID: 1, Username: "bob", IsAdmin: false}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(auth.WithUser(req.Context(), nonAdmin))
	w := httptest.NewRecorder()
	h.RequireAdmin(okHandler).ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin, got %d", w.Code)
	}
}

func TestRequireAdmin_Admin(t *testing.T) {
	h, _ := newMiddlewareFixture(t)

	admin := &auth.User{ID: 1, Username: "admin", IsAdmin: true}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(auth.WithUser(req.Context(), admin))
	w := httptest.NewRecorder()
	h.RequireAdmin(okHandler).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for admin, got %d", w.Code)
	}
}

func TestChain_ComposesMiddleware(t *testing.T) {
	// Chain two middlewares: first adds header A, second adds header B.
	// Verify both fire in correct order around the inner handler.
	var order []string

	mwA := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			order = append(order, "A-before")
			next.ServeHTTP(w, r)
			order = append(order, "A-after")
		})
	}
	mwB := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			order = append(order, "B-before")
			next.ServeHTTP(w, r)
			order = append(order, "B-after")
		})
	}
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		order = append(order, "handler")
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	auth.Chain(inner, mwA, mwB).ServeHTTP(w, req)

	want := []string{"A-before", "B-before", "handler", "B-after", "A-after"}
	if len(order) != len(want) {
		t.Fatalf("chain order: got %v, want %v", order, want)
	}
	for i, s := range order {
		if s != want[i] {
			t.Errorf("order[%d]: got %q, want %q", i, s, want[i])
		}
	}
}

func TestWithUser_And_UserFromContext(t *testing.T) {
	u := &auth.User{ID: 42, Username: "test"}
	ctx := auth.WithUser(t.Context(), u)
	got := auth.UserFromContext(ctx)
	if got == nil || got.ID != 42 {
		t.Fatalf("UserFromContext: got %v", got)
	}
}

func TestUserFromContext_Nil(t *testing.T) {
	got := auth.UserFromContext(t.Context())
	if got != nil {
		t.Fatalf("expected nil, got %v", got)
	}
}
