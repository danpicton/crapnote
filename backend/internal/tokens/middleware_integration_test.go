package tokens_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/tokens"
)

type bearerFixture struct {
	database *db.DB
	users    *auth.UserRepo
	authH    *auth.Handler
	svc      *tokens.Service
	admin    *auth.User
	user     *auth.User
}

func newBearerFixture(t *testing.T) *bearerFixture {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	users := auth.NewUserRepo(database)
	sessions := auth.NewSessionRepo(database)
	authSvc := auth.NewService(users, sessions, 24*time.Hour)
	authH := auth.NewHandler(authSvc)

	admin, err := users.Create(t.Context(), "root", "hash", true)
	if err != nil {
		t.Fatalf("create root: %v", err)
	}
	u, err := users.Create(t.Context(), "alice", "hash", false)
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}

	tsvc := tokens.NewService(tokens.NewRepo(database), users)
	authH.SetBearerAuthenticator(tokens.NewBearerAuth(tsvc, nil))

	return &bearerFixture{
		database: database, users: users, authH: authH, svc: tsvc,
		admin: admin, user: u,
	}
}

var noopHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	_ = auth.UserFromContext(r.Context())
	w.WriteHeader(http.StatusOK)
})

func TestBearer_AcceptsValidToken_AttachesUser(t *testing.T) {
	f := newBearerFixture(t)
	created, err := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeReadWrite, 0)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	var gotUser *auth.User
	var wroteAllowed bool
	var viaBearer bool
	capture := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser = auth.UserFromContext(r.Context())
		wroteAllowed = auth.WriteAllowed(r.Context())
		viaBearer = auth.IsBearerAuth(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+created.RawToken)
	w := httptest.NewRecorder()
	f.authH.RequireAuth(capture).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if gotUser == nil || gotUser.ID != f.admin.ID {
		t.Fatalf("expected admin user, got %+v", gotUser)
	}
	if !wroteAllowed {
		t.Fatal("expected WriteAllowed=true for read_write token")
	}
	if !viaBearer {
		t.Fatal("expected IsBearerAuth=true")
	}
}

func TestBearer_ReadScope_WriteAllowedFalse(t *testing.T) {
	f := newBearerFixture(t)
	created, _ := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeRead, 0)

	var wroteAllowed bool
	capture := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wroteAllowed = auth.WriteAllowed(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+created.RawToken)
	w := httptest.NewRecorder()
	f.authH.RequireAuth(capture).ServeHTTP(w, req)

	if wroteAllowed {
		t.Fatal("expected WriteAllowed=false for read-only token")
	}
}

func TestBearer_InvalidToken_401(t *testing.T) {
	f := newBearerFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer cnp_doesnotexist")
	w := httptest.NewRecorder()
	f.authH.RequireAuth(noopHandler).ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestBearer_BadSchemeFallsBackToCookie(t *testing.T) {
	f := newBearerFixture(t)
	// Non-bearer auth header with no cookie → 401 from cookie path.
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")
	w := httptest.NewRecorder()
	f.authH.RequireAuth(noopHandler).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (no cookie), got %d", w.Code)
	}
}

func TestBearer_RequireAdmin_RejectsBearerEvenForAdmin(t *testing.T) {
	f := newBearerFixture(t)
	created, _ := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeReadWrite, 0)

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+created.RawToken)
	w := httptest.NewRecorder()
	f.authH.RequireAuth(f.authH.RequireAdmin(noopHandler)).ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestBearer_RequireWrite_RejectsReadScope(t *testing.T) {
	f := newBearerFixture(t)
	created, _ := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeRead, 0)

	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+created.RawToken)
	w := httptest.NewRecorder()
	f.authH.RequireAuth(f.authH.RequireWrite(noopHandler)).ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for read token on write endpoint, got %d", w.Code)
	}
}

func TestBearer_RequireWrite_AllowsReadWrite(t *testing.T) {
	f := newBearerFixture(t)
	created, _ := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeReadWrite, 0)

	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+created.RawToken)
	w := httptest.NewRecorder()
	f.authH.RequireAuth(f.authH.RequireWrite(noopHandler)).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestBearer_CookieAuth_WriteAllowedTrue(t *testing.T) {
	f := newBearerFixture(t)
	// Enable cookie path: seed + login.
	authSvc := auth.NewService(f.users, auth.NewSessionRepo(f.database), time.Hour)
	// Reset user bob to use bcrypt hash.
	if err := authSvc.SeedAdmin(t.Context(), "bob", "longpassword"); err != nil {
		t.Fatalf("seed (noop since users exist): %v", err)
	}
	// "bob" not seeded because admin already exists. Instead create directly via login of admin by inserting a session.
	sessRepo := auth.NewSessionRepo(f.database)
	sess, err := sessRepo.Create(t.Context(), f.admin.ID, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	var wroteAllowed bool
	capture := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wroteAllowed = auth.WriteAllowed(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sess.ID})
	w := httptest.NewRecorder()
	f.authH.RequireAuth(capture).ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if !wroteAllowed {
		t.Fatal("expected WriteAllowed=true for cookie auth")
	}
}
