package auth_test

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
)

// withAuditLogger replaces slog.Default for the duration of the test and
// returns a buffer containing captured log output.
func withAuditLogger(t *testing.T) *bytes.Buffer {
	t.Helper()
	prev := slog.Default()
	var buf bytes.Buffer
	// A text handler at DEBUG keeps every audit event (Info/Warn/Error).
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func newAuditFixture(t *testing.T) (*auth.Handler, *auth.AdminHandler, *auth.Service, *auth.UserRepo) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	userRepo := auth.NewUserRepo(database)
	svc := auth.NewService(userRepo, auth.NewSessionRepo(database), 7*24*time.Hour)
	return auth.NewHandler(svc), auth.NewAdminHandler(userRepo), svc, userRepo
}

func TestAudit_FailedLoginIsLogged(t *testing.T) {
	buf := withAuditLogger(t)
	h, _, svc, _ := newAuditFixture(t)
	svc.SeedAdmin(t.Context(), "admin", "correct") //nolint:errcheck

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		strings.NewReader(`{"username":"admin","password":"wrong"}`))
	req.RemoteAddr = "198.51.100.7:1111"
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Login(w, req)

	out := buf.String()
	if !strings.Contains(out, "event=login_failed") {
		t.Fatalf("expected login_failed event in audit log, got: %s", out)
	}
	if !strings.Contains(out, "username=admin") {
		t.Fatalf("expected username in audit log, got: %s", out)
	}
	if !strings.Contains(out, "ip=198.51.100.7") {
		t.Fatalf("expected client IP in audit log, got: %s", out)
	}
}

func TestAudit_SuccessfulLoginIsLogged(t *testing.T) {
	buf := withAuditLogger(t)
	h, _, svc, _ := newAuditFixture(t)
	svc.SeedAdmin(t.Context(), "admin", "correct") //nolint:errcheck

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login",
		strings.NewReader(`{"username":"admin","password":"correct"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-For", "203.0.113.9")
	w := httptest.NewRecorder()
	h.Login(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("login did not succeed: %d %s", w.Code, w.Body.String())
	}

	out := buf.String()
	if !strings.Contains(out, "event=login_succeeded") {
		t.Fatalf("expected login_succeeded event in audit log, got: %s", out)
	}
	if !strings.Contains(out, "user_id=1") {
		t.Fatalf("expected user_id in audit log, got: %s", out)
	}
	if !strings.Contains(out, "ip=203.0.113.9") {
		t.Fatalf("expected X-Forwarded-For IP in audit log, got: %s", out)
	}
}

func TestAudit_UserCreationIsLogged(t *testing.T) {
	buf := withAuditLogger(t)
	_, admin, _, userRepo := newAuditFixture(t)

	actor, err := userRepo.Create(t.Context(), "root", "$2a$12$x", true)
	if err != nil {
		t.Fatalf("seed actor: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/users",
		strings.NewReader(`{"username":"bob","password":"correcthorsebattery","is_admin":false}`))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(auth.WithUser(req.Context(), actor))
	w := httptest.NewRecorder()
	admin.CreateUser(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("create user failed: %d %s", w.Code, w.Body.String())
	}

	out := buf.String()
	if !strings.Contains(out, "event=user_created") {
		t.Fatalf("expected user_created event in audit log, got: %s", out)
	}
	if !strings.Contains(out, "new_username=bob") {
		t.Fatalf("expected new_username in audit log, got: %s", out)
	}
	if !strings.Contains(out, "admin_id=1") {
		t.Fatalf("expected admin_id in audit log, got: %s", out)
	}
}

func TestAudit_UserDeletionIsLogged(t *testing.T) {
	buf := withAuditLogger(t)
	_, admin, _, userRepo := newAuditFixture(t)

	actor, _ := userRepo.Create(t.Context(), "root", "$2a$12$x", true)
	target, _ := userRepo.Create(t.Context(), "victim", "$2a$12$x", false)

	req := httptest.NewRequest(http.MethodDelete, "/api/admin/users/2", nil)
	req.SetPathValue("id", strconv.FormatInt(target.ID, 10))
	req = req.WithContext(auth.WithUser(req.Context(), actor))
	w := httptest.NewRecorder()
	admin.DeleteUser(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("delete user failed: %d %s", w.Code, w.Body.String())
	}

	out := buf.String()
	if !strings.Contains(out, "event=user_deleted") {
		t.Fatalf("expected user_deleted event in audit log, got: %s", out)
	}
	if !strings.Contains(out, "admin_id=1") {
		t.Fatalf("expected admin_id in audit log, got: %s", out)
	}
}

