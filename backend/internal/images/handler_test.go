package images_test

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/images"
)

func newFixture(t *testing.T) (*images.Handler, *auth.User) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	userRepo := auth.NewUserRepo(database)
	user, err := userRepo.Create(t.Context(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	return images.NewHandler(database), user
}

func withUser(r *http.Request, u *auth.User) *http.Request {
	return r.WithContext(auth.WithUser(r.Context(), u))
}

// multipartUpload builds a multipart/form-data request with an "image" field.
// An optional Content-Type part header can be set via partContentType (empty = no header).
func multipartUpload(t *testing.T, content []byte, partContentType string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)

	if partContentType != "" {
		h := make(map[string][]string)
		h["Content-Disposition"] = []string{`form-data; name="image"; filename="upload"`}
		h["Content-Type"] = []string{partContentType}
		part, err := mw.CreatePart(h)
		if err != nil {
			t.Fatalf("create part: %v", err)
		}
		io.Copy(part, bytes.NewReader(content)) //nolint:errcheck
	} else {
		part, err := mw.CreateFormFile("image", "upload")
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		io.Copy(part, bytes.NewReader(content)) //nolint:errcheck
	}
	mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/images", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func TestUpload_Success(t *testing.T) {
	h, user := newFixture(t)

	req := multipartUpload(t, minimalPNG(), "")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Upload(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	url, ok := resp["url"]
	if !ok || !strings.HasPrefix(url, "/api/images/") {
		t.Fatalf("expected url starting with /api/images/, got %q", url)
	}
}

func TestUpload_ExplicitContentType(t *testing.T) {
	h, user := newFixture(t)

	req := multipartUpload(t, minimalPNG(), "image/jpeg")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Upload(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpload_NoAuth(t *testing.T) {
	h, _ := newFixture(t)

	req := multipartUpload(t, minimalPNG(), "")
	// No user injected
	w := httptest.NewRecorder()
	h.Upload(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestUpload_MissingImageField(t *testing.T) {
	h, user := newFixture(t)

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("not_image", "file.png")
	io.Copy(part, bytes.NewReader(minimalPNG())) //nolint:errcheck
	mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/images", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Upload(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestServe_Success(t *testing.T) {
	h, user := newFixture(t)

	// Upload first
	req := multipartUpload(t, minimalPNG(), "")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Upload(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("upload failed: %d %s", w.Code, w.Body.String())
	}

	var uploadResp map[string]string
	json.NewDecoder(w.Body).Decode(&uploadResp) //nolint:errcheck
	imageID := strings.TrimPrefix(uploadResp["url"], "/api/images/")

	// Serve it back
	req2 := httptest.NewRequest(http.MethodGet, "/api/images/"+imageID, nil)
	req2.SetPathValue("id", imageID)
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.Serve(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
	if w2.Body.Len() == 0 {
		t.Fatal("expected image bytes in response body")
	}
	if cc := w2.Header().Get("Cache-Control"); cc == "" {
		t.Fatal("expected Cache-Control header")
	}
	if ct := w2.Header().Get("Content-Type"); ct == "" {
		t.Fatal("expected Content-Type header")
	}
}

func TestServe_NotFound(t *testing.T) {
	h, user := newFixture(t)

	req := httptest.NewRequest(http.MethodGet, "/api/images/no-such-id", nil)
	req.SetPathValue("id", "no-such-id")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Serve(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestServe_NoAuth(t *testing.T) {
	h, _ := newFixture(t)

	req := httptest.NewRequest(http.MethodGet, "/api/images/some-id", nil)
	req.SetPathValue("id", "some-id")
	w := httptest.NewRecorder()
	h.Serve(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestServe_WrongUser(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	userRepo := auth.NewUserRepo(database)
	alice, _ := userRepo.Create(t.Context(), "alice", "$2a$12$x", false)
	bob, _ := userRepo.Create(t.Context(), "bob", "$2a$12$x", false)
	h := images.NewHandler(database)

	// Alice uploads an image
	req := multipartUpload(t, minimalPNG(), "")
	req = withUser(req, alice)
	w := httptest.NewRecorder()
	h.Upload(w, req)
	var uploadResp map[string]string
	json.NewDecoder(w.Body).Decode(&uploadResp) //nolint:errcheck
	imageID := strings.TrimPrefix(uploadResp["url"], "/api/images/")

	// Bob tries to access Alice's image — should get 404 (not 403, to avoid leaking existence)
	req2 := httptest.NewRequest(http.MethodGet, "/api/images/"+imageID, nil)
	req2.SetPathValue("id", imageID)
	req2 = withUser(req2, bob)
	w2 := httptest.NewRecorder()
	h.Serve(w2, req2)

	if w2.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for cross-user access, got %d", w2.Code)
	}
}

func TestFetchByIDs_Empty(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	result, err := images.FetchByIDs(t.Context(), database, 1, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != nil {
		t.Fatalf("expected nil for empty ids, got %v", result)
	}
}

func TestFetchByIDs_OwnershipCheck(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	userRepo := auth.NewUserRepo(database)
	alice, _ := userRepo.Create(t.Context(), "alice", "$2a$12$x", false)
	bob, _ := userRepo.Create(t.Context(), "bob", "$2a$12$x", false)

	h := images.NewHandler(database)
	req := multipartUpload(t, minimalPNG(), "")
	req = withUser(req, alice)
	w := httptest.NewRecorder()
	h.Upload(w, req)
	var uploadResp map[string]string
	json.NewDecoder(w.Body).Decode(&uploadResp) //nolint:errcheck
	imageID := strings.TrimPrefix(uploadResp["url"], "/api/images/")

	aliceData, err := images.FetchByIDs(t.Context(), database, alice.ID, []string{imageID})
	if err != nil {
		t.Fatalf("FetchByIDs alice: %v", err)
	}
	if len(aliceData) != 1 {
		t.Fatalf("alice: expected 1 image, got %d", len(aliceData))
	}

	bobData, err := images.FetchByIDs(t.Context(), database, bob.ID, []string{imageID})
	if err != nil {
		t.Fatalf("FetchByIDs bob: %v", err)
	}
	if len(bobData) != 0 {
		t.Fatalf("bob: expected 0 images (silently omitted), got %d", len(bobData))
	}
}

func TestFetchByIDs_NonExistent(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()

	result, err := images.FetchByIDs(t.Context(), database, 1, []string{"does-not-exist"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result) != 0 {
		t.Fatalf("expected empty map for non-existent id, got %v", result)
	}
}

// minimalPNG returns a valid 1x1 pixel PNG image.
func minimalPNG() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
		0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
		0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
		0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
		0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
		0x44, 0xae, 0x42, 0x60, 0x82,
	}
}
