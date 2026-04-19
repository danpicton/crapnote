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

func newAdminFixture(t *testing.T) (*auth.AdminHandler, *auth.User, *auth.Service) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	userRepo := auth.NewUserRepo(database)
	sessRepo := auth.NewSessionRepo(database)
	svc := auth.NewService(userRepo, sessRepo, 7*24*time.Hour)

	// Seed an admin user.
	if err := svc.SeedAdmin(context.Background(), "admin", "pass"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	admin, err := userRepo.FindByUsername(context.Background(), "admin")
	if err != nil {
		t.Fatalf("find admin: %v", err)
	}

	return auth.NewAdminHandler(userRepo), admin, svc
}

func adminRequest(r *http.Request, u *auth.User) *http.Request {
	return r.WithContext(auth.WithUser(r.Context(), u))
}

func TestAdminHandler_ListUsers(t *testing.T) {
	h, admin, _ := newAdminFixture(t)

	req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	req = adminRequest(req, admin)
	w := httptest.NewRecorder()
	h.ListUsers(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list []any
	json.NewDecoder(w.Body).Decode(&list) //nolint:errcheck
	if len(list) != 1 {
		t.Fatalf("expected 1 user, got %d", len(list))
	}
}

func TestAdminHandler_CreateUser(t *testing.T) {
	h, admin, _ := newAdminFixture(t)

	body := `{"username":"bob","password":"s3cret-l0ng-enough","is_admin":false}`
	req := httptest.NewRequest(http.MethodPost, "/api/admin/users", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = adminRequest(req, admin)
	w := httptest.NewRecorder()
	h.CreateUser(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp) //nolint:errcheck
	if resp["username"] != "bob" {
		t.Fatalf("unexpected username: %v", resp["username"])
	}
	// Password must NOT be in the response.
	if _, ok := resp["password_hash"]; ok {
		t.Fatal("password_hash must not be returned")
	}
}

func TestAdminHandler_DeleteUser(t *testing.T) {
	h, admin, svc := newAdminFixture(t)
	ctx := context.Background()

	// Create a non-admin user to delete.
	svc.SeedAdmin(ctx, "admin", "pass") //nolint:errcheck (already exists, no-op)
	// Create another user via CreateUser endpoint.
	body := `{"username":"carol","password":"correct-horse-battery","is_admin":false}`
	req := httptest.NewRequest(http.MethodPost, "/api/admin/users", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = adminRequest(req, admin)
	w := httptest.NewRecorder()
	h.CreateUser(w, req)
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	carolID := int64(created["id"].(float64))

	// Delete carol.
	req2 := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/admin/users/%d", carolID), nil)
	req2.SetPathValue("id", fmt.Sprintf("%d", carolID))
	req2 = adminRequest(req2, admin)
	w2 := httptest.NewRecorder()
	h.DeleteUser(w2, req2)

	if w2.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w2.Code, w2.Body.String())
	}
}

func TestAdminHandler_CreateUser_ShortPasswordRejected(t *testing.T) {
	h, admin, _ := newAdminFixture(t)

	body := `{"username":"shortpw","password":"tooshort"}`
	req := httptest.NewRequest(http.MethodPost, "/api/admin/users", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = adminRequest(req, admin)
	w := httptest.NewRecorder()
	h.CreateUser(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for short password, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAdminHandler_SetAPITokensEnabled_TogglesFlag(t *testing.T) {
	h, admin, _ := newAdminFixture(t)
	// Create a non-admin user whose flag we'll toggle.
	body := `{"username":"dave","password":"correct-horse-battery","is_admin":false}`
	req := httptest.NewRequest(http.MethodPost, "/api/admin/users", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = adminRequest(req, admin)
	w := httptest.NewRecorder()
	h.CreateUser(w, req)
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	daveID := int64(created["id"].(float64))

	// Enable.
	req2 := httptest.NewRequest(http.MethodPatch,
		fmt.Sprintf("/api/admin/users/%d/api-tokens", daveID),
		bytes.NewBufferString(`{"enabled":true}`))
	req2.SetPathValue("id", fmt.Sprintf("%d", daveID))
	req2 = adminRequest(req2, admin)
	w2 := httptest.NewRecorder()
	h.SetAPITokensEnabled(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(w2.Body).Decode(&resp) //nolint:errcheck
	if resp["api_tokens_enabled"] != true {
		t.Fatalf("expected api_tokens_enabled true, got %v", resp["api_tokens_enabled"])
	}

	// Disable.
	req3 := httptest.NewRequest(http.MethodPatch,
		fmt.Sprintf("/api/admin/users/%d/api-tokens", daveID),
		bytes.NewBufferString(`{"enabled":false}`))
	req3.SetPathValue("id", fmt.Sprintf("%d", daveID))
	req3 = adminRequest(req3, admin)
	w3 := httptest.NewRecorder()
	h.SetAPITokensEnabled(w3, req3)

	if w3.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w3.Code)
	}
	var resp2 map[string]any
	json.NewDecoder(w3.Body).Decode(&resp2) //nolint:errcheck
	if resp2["api_tokens_enabled"] != false {
		t.Fatalf("expected api_tokens_enabled false, got %v", resp2["api_tokens_enabled"])
	}
}

func TestAdminHandler_SetAPITokensEnabled_UnknownUser_404(t *testing.T) {
	h, admin, _ := newAdminFixture(t)
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/99999/api-tokens",
		bytes.NewBufferString(`{"enabled":true}`))
	req.SetPathValue("id", "99999")
	req = adminRequest(req, admin)
	w := httptest.NewRecorder()
	h.SetAPITokensEnabled(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestAdminHandler_DeleteUser_CannotDeleteSelf(t *testing.T) {
	h, admin, _ := newAdminFixture(t)

	req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/admin/users/%d", admin.ID), nil)
	req.SetPathValue("id", fmt.Sprintf("%d", admin.ID))
	req = adminRequest(req, admin)
	w := httptest.NewRecorder()
	h.DeleteUser(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for self-delete, got %d", w.Code)
	}
}
