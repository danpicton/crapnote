package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/notes"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/danpicton/crapnote/internal/trash"
)

// newTestMux builds a fully wired mux backed by an in-memory DB.
func newTestMux(t *testing.T) *http.ServeMux {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	authSvc := auth.NewService(
		auth.NewUserRepo(database),
		auth.NewSessionRepo(database),
		7*24*time.Hour,
	)
	notesSvc := notes.NewService(notes.NewRepo(database))
	return newMux(
		auth.NewHandler(authSvc),
		auth.NewAdminHandler(auth.NewUserRepo(database)),
		notes.NewHandler(notesSvc),
		tags.NewHandler(tags.NewService(tags.NewRepo(database))),
		trash.NewHandler(trash.NewService(trash.NewRepo(database))),
		export.NewHandler(notesSvc, database),
		images.NewHandler(database),
	)
}

// newAuthedMux creates a mux and seeds an admin user; returns the mux and a valid session cookie.
func newAuthedMux(t *testing.T) (*http.ServeMux, *http.Cookie) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	userRepo := auth.NewUserRepo(database)
	sessRepo := auth.NewSessionRepo(database)
	authSvc := auth.NewService(userRepo, sessRepo, 7*24*time.Hour)

	if err := authSvc.SeedAdmin(t.Context(), "admin", "pass"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	notesSvc := notes.NewService(notes.NewRepo(database))
	mux := newMux(
		auth.NewHandler(authSvc),
		auth.NewAdminHandler(userRepo),
		notes.NewHandler(notesSvc),
		tags.NewHandler(tags.NewService(tags.NewRepo(database))),
		trash.NewHandler(trash.NewService(trash.NewRepo(database))),
		export.NewHandler(notesSvc, database),
		images.NewHandler(database),
	)

	// Perform a login to obtain a session cookie.
	loginBody := `{"username":"admin","password":"pass"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(loginBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", w.Code, w.Body.String())
	}
	var sessionCookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Fatal("no session cookie after login")
	}
	return mux, sessionCookie
}

func TestHealthCheck(t *testing.T) {
	mux := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("expected JSON body, got error: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %q", body["status"])
	}
}

func TestProtectedRouteRequiresAuth(t *testing.T) {
	mux := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated /api/auth/me, got %d", w.Code)
	}
}

// protectedRoutes lists routes that must return 401 when no session cookie is present.
var protectedRoutes = []struct {
	method string
	path   string
}{
	{http.MethodGet, "/api/notes"},
	{http.MethodPost, "/api/notes"},
	{http.MethodGet, "/api/notes/1"},
	{http.MethodPut, "/api/notes/1"},
	{http.MethodDelete, "/api/notes/1"},
	{http.MethodPatch, "/api/notes/1/star"},
	{http.MethodPatch, "/api/notes/1/pin"},
	{http.MethodPatch, "/api/notes/1/archive"},
	{http.MethodPatch, "/api/notes/1/unarchive"},
	{http.MethodGet, "/api/archive"},
	{http.MethodGet, "/api/tags"},
	{http.MethodPost, "/api/tags"},
	{http.MethodPut, "/api/tags/1"},
	{http.MethodDelete, "/api/tags/1"},
	{http.MethodGet, "/api/export"},
	{http.MethodPost, "/api/images"},
	{http.MethodGet, "/api/images/someid"},
	{http.MethodGet, "/api/trash"},
	{http.MethodPost, "/api/trash/1/restore"},
	{http.MethodDelete, "/api/trash/1"},
	{http.MethodDelete, "/api/trash"},
	{http.MethodPost, "/api/auth/logout"},
	{http.MethodGet, "/api/auth/me"},
}

func TestAllProtectedRoutesRequireAuth(t *testing.T) {
	mux := newTestMux(t)
	for _, tc := range protectedRoutes {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401, got %d", w.Code)
			}
		})
	}
}

func TestAdminRouteRequiresAdmin(t *testing.T) {
	mux := newTestMux(t)

	// Admin routes need auth — without it we get 401.
	req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated admin route, got %d", w.Code)
	}
}

func TestLogin_Endpoint(t *testing.T) {
	mux := newTestMux(t)

	// Seed a user first via SeedAdmin — but we only have the mux, not the service.
	// Use the login endpoint: wrong credentials → 401.
	body := `{"username":"nobody","password":"bad"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for bad credentials, got %d", w.Code)
	}
}

func TestAuthenticatedEndpoints(t *testing.T) {
	mux, cookie := newAuthedMux(t)

	authedReq := func(method, path string, body string) *httptest.ResponseRecorder {
		var reqBody *bytes.Buffer
		if body != "" {
			reqBody = bytes.NewBufferString(body)
		} else {
			reqBody = &bytes.Buffer{}
		}
		req := httptest.NewRequest(method, path, reqBody)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		return w
	}

	// GET /api/auth/me
	w := authedReq(http.MethodGet, "/api/auth/me", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/auth/me: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// GET /api/notes
	w = authedReq(http.MethodGet, "/api/notes", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/notes: expected 200, got %d", w.Code)
	}

	// POST /api/notes
	w = authedReq(http.MethodPost, "/api/notes", `{"title":"Server Test","body":"hello"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("POST /api/notes: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	noteID := int64(created["id"].(float64))

	// GET /api/notes/{id}
	w = authedReq(http.MethodGet, fmt.Sprintf("/api/notes/%d", noteID), "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/notes/%d: expected 200, got %d", noteID, w.Code)
	}

	// GET /api/tags
	w = authedReq(http.MethodGet, "/api/tags", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/tags: expected 200, got %d", w.Code)
	}

	// GET /api/archive
	w = authedReq(http.MethodGet, "/api/archive", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/archive: expected 200, got %d", w.Code)
	}

	// GET /api/trash
	w = authedReq(http.MethodGet, "/api/trash", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/trash: expected 200, got %d", w.Code)
	}

	// GET /api/export
	w = authedReq(http.MethodGet, "/api/export", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/export: expected 200, got %d", w.Code)
	}

	// GET /api/admin/users (admin user is logged in)
	w = authedReq(http.MethodGet, "/api/admin/users", "")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/admin/users: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// POST /api/auth/logout
	w = authedReq(http.MethodPost, "/api/auth/logout", "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("POST /api/auth/logout: expected 204, got %d", w.Code)
	}
}
