package images_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/images"
)

// newFixtureWith builds an images.Handler with a custom Config so tests can
// exercise rate-limit and quota boundaries without depending on production
// defaults.
func newFixtureWith(t *testing.T, cfg images.Config) (*images.Handler, *auth.User) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	user, err := auth.NewUserRepo(database).Create(t.Context(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	return images.NewHandlerWith(database, cfg), user
}

// Uploads that are not actually image bytes must be rejected with 415 —
// attackers cannot rely on the Content-Type header alone.
func TestUpload_RejectsNonImageBytes(t *testing.T) {
	h, user := newFixture(t)

	req := multipartUpload(t, []byte("not an image at all, just text"), "image/png")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Upload(w, req)

	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415 for non-image bytes, got %d: %s", w.Code, w.Body.String())
	}
}

// Uploads that would push a user over their quota must be rejected with 507.
func TestUpload_EnforcesPerUserQuota(t *testing.T) {
	// Quota of 50 bytes — single minimal PNG (~67 bytes) exceeds it.
	h, user := newFixtureWith(t, images.Config{UploadsPerMinute: 100, QuotaBytes: 50})

	req := multipartUpload(t, minimalPNG(), "")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Upload(w, req)

	if w.Code != http.StatusInsufficientStorage {
		t.Fatalf("expected 507 when over quota, got %d: %s", w.Code, w.Body.String())
	}
}

// After the per-user burst is exhausted, further uploads return 429.
func TestUpload_RateLimitedPerUser(t *testing.T) {
	h, user := newFixtureWith(t, images.Config{UploadsPerMinute: 1, QuotaBytes: 100 << 20})

	upload := func() int {
		req := multipartUpload(t, minimalPNG(), "")
		req = withUser(req, user)
		w := httptest.NewRecorder()
		h.Upload(w, req)
		return w.Code
	}

	if code := upload(); code != http.StatusCreated {
		t.Fatalf("first upload: expected 201, got %d", code)
	}
	if code := upload(); code != http.StatusTooManyRequests {
		t.Fatalf("second upload: expected 429 after burst, got %d", code)
	}
}

// Rate-limit buckets are keyed by user so one user cannot starve another.
func TestUpload_RateLimitIsPerUser(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	userRepo := auth.NewUserRepo(database)
	alice, _ := userRepo.Create(t.Context(), "alice", "$2a$12$x", false)
	bob, _ := userRepo.Create(t.Context(), "bob", "$2a$12$x", false)
	h := images.NewHandlerWith(database, images.Config{UploadsPerMinute: 1, QuotaBytes: 100 << 20})

	// Alice spends her single allowed upload.
	req := multipartUpload(t, minimalPNG(), "")
	req = withUser(req, alice)
	w := httptest.NewRecorder()
	h.Upload(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("alice upload: expected 201, got %d", w.Code)
	}

	// Bob should still be able to upload — his bucket is independent.
	req = multipartUpload(t, minimalPNG(), "")
	req = withUser(req, bob)
	w = httptest.NewRecorder()
	h.Upload(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("bob upload: expected 201, got %d (alice's bucket should not affect bob)", w.Code)
	}
}

