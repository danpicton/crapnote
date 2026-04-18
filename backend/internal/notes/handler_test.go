package notes_test

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
	"github.com/danpicton/crapnote/internal/notes"
)

// newHandlerFixture builds a Handler with an authenticated user injected.
func newHandlerFixture(t *testing.T) (*notes.Handler, *auth.User) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	// Create a user via the auth package so the FK constraint is met.
	userRepo := auth.NewUserRepo(database)
	user, err := userRepo.Create(context.Background(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	svc := notes.NewService(notes.NewRepo(database))
	return notes.NewHandler(svc), user
}

// withUser injects a user into a request context (simulates RequireAuth middleware).
func withUser(r *http.Request, u *auth.User) *http.Request {
	return r.WithContext(auth.WithUser(r.Context(), u))
}

func TestNotesHandler_Create(t *testing.T) {
	h, user := newHandlerFixture(t)

	body := `{"title":"Hello","body":"World"}`
	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()

	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp) //nolint:errcheck
	if resp["title"] != "Hello" {
		t.Fatalf("unexpected title: %v", resp["title"])
	}
}

func TestNotesHandler_Create_DefaultTitle(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp) //nolint:errcheck
	title, _ := resp["title"].(string)
	if len(title) < 7 {
		t.Fatalf("expected default title, got %q", title)
	}
}

func TestNotesHandler_List(t *testing.T) {
	h, user := newHandlerFixture(t)
	ctx := context.Background()
	svc := notes.NewService(notes.NewRepo(nil)) // just to satisfy compiler — not used here
	_ = svc

	// Create notes directly via service (fixture has its own DB).
	// Re-use the handler's service via Create endpoint to stay consistent.
	for _, title := range []string{"A", "B", "C"} {
		body := fmt.Sprintf(`{"title":%q}`, title)
		req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req = withUser(req, user)
		w := httptest.NewRecorder()
		h.Create(w, req)
	}
	_ = ctx

	req := httptest.NewRequest(http.MethodGet, "/api/notes", nil)
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.List(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp []any
	json.NewDecoder(w.Body).Decode(&resp) //nolint:errcheck
	if len(resp) != 3 {
		t.Fatalf("expected 3 notes, got %d", len(resp))
	}
}

func TestNotesHandler_GetAndUpdate(t *testing.T) {
	h, user := newHandlerFixture(t)

	// Create
	body := `{"title":"Draft","body":"initial"}`
	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)

	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	id := int64(created["id"].(float64))

	// Get
	req2 := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/notes/%d", id), nil)
	req2.SetPathValue("id", fmt.Sprintf("%d", id))
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.Get(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("Get: expected 200, got %d", w2.Code)
	}

	// Update
	upBody := `{"title":"Updated","body":"new content"}`
	req3 := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/notes/%d", id), bytes.NewBufferString(upBody))
	req3.Header.Set("Content-Type", "application/json")
	req3.SetPathValue("id", fmt.Sprintf("%d", id))
	req3 = withUser(req3, user)
	w3 := httptest.NewRecorder()
	h.Update(w3, req3)

	if w3.Code != http.StatusOK {
		t.Fatalf("Update: expected 200, got %d: %s", w3.Code, w3.Body.String())
	}
	var updated map[string]any
	json.NewDecoder(w3.Body).Decode(&updated) //nolint:errcheck
	if updated["title"] != "Updated" {
		t.Fatalf("unexpected title: %v", updated["title"])
	}
}

func TestNotesHandler_Delete(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(`{"title":"Bye"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	id := int64(created["id"].(float64))

	req2 := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/notes/%d", id), nil)
	req2.SetPathValue("id", fmt.Sprintf("%d", id))
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.Delete(w2, req2)

	if w2.Code != http.StatusNoContent {
		t.Fatalf("Delete: expected 204, got %d", w2.Code)
	}
}

func TestNotesHandler_ToggleStar(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(`{"title":"Star me"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	id := int64(created["id"].(float64))

	req2 := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/notes/%d/star", id), nil)
	req2.SetPathValue("id", fmt.Sprintf("%d", id))
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.ToggleStar(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("ToggleStar: expected 200, got %d", w2.Code)
	}
	var resp map[string]any
	json.NewDecoder(w2.Body).Decode(&resp) //nolint:errcheck
	if resp["starred"] != true {
		t.Fatalf("expected starred=true, got %v", resp["starred"])
	}
}

func TestNotesHandler_TogglePin(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(`{"title":"Pin me"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	id := int64(created["id"].(float64))

	req2 := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/notes/%d/pin", id), nil)
	req2.SetPathValue("id", fmt.Sprintf("%d", id))
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.TogglePin(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("TogglePin: expected 200, got %d", w2.Code)
	}
	var resp map[string]any
	json.NewDecoder(w2.Body).Decode(&resp) //nolint:errcheck
	if resp["pinned"] != true {
		t.Fatalf("expected pinned=true, got %v", resp["pinned"])
	}
}

func TestNotesHandler_Get_NotFound(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodGet, "/api/notes/9999", nil)
	req.SetPathValue("id", "9999")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Get(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// Unused import guard — time is referenced indirectly.
var _ = time.Now

func TestNotesHandler_Archive(t *testing.T) {
	h, user := newHandlerFixture(t)

	// Create a note.
	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(`{"title":"Archive me"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	id := int64(created["id"].(float64))

	// Archive it.
	req2 := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/notes/%d/archive", id), nil)
	req2.SetPathValue("id", fmt.Sprintf("%d", id))
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.Archive(w2, req2)

	if w2.Code != http.StatusNoContent {
		t.Fatalf("Archive: expected 204, got %d: %s", w2.Code, w2.Body)
	}

	// Normal GET should now 404.
	req3 := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/notes/%d", id), nil)
	req3.SetPathValue("id", fmt.Sprintf("%d", id))
	req3 = withUser(req3, user)
	w3 := httptest.NewRecorder()
	h.Get(w3, req3)
	if w3.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for archived note, got %d", w3.Code)
	}
}

func TestNotesHandler_ListArchived(t *testing.T) {
	h, user := newHandlerFixture(t)

	// Create and archive a note.
	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(`{"title":"In Archive"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	id := int64(created["id"].(float64))

	req2 := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/notes/%d/archive", id), nil)
	req2.SetPathValue("id", fmt.Sprintf("%d", id))
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.Archive(w2, req2)

	// ListArchived should return it.
	req3 := httptest.NewRequest(http.MethodGet, "/api/archive", nil)
	req3 = withUser(req3, user)
	w3 := httptest.NewRecorder()
	h.ListArchived(w3, req3)

	if w3.Code != http.StatusOK {
		t.Fatalf("ListArchived: expected 200, got %d", w3.Code)
	}
	var list []map[string]any
	json.NewDecoder(w3.Body).Decode(&list) //nolint:errcheck
	if len(list) != 1 || list[0]["title"] != "In Archive" {
		t.Fatalf("unexpected archived list: %v", list)
	}
}

func TestNotesHandler_Unarchive(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(`{"title":"Restore"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	id := int64(created["id"].(float64))

	// Archive then unarchive.
	for _, method := range []func(http.ResponseWriter, *http.Request){h.Archive, h.Unarchive} {
		r := httptest.NewRequest(http.MethodPatch, "/", nil)
		r.SetPathValue("id", fmt.Sprintf("%d", id))
		r = withUser(r, user)
		ww := httptest.NewRecorder()
		method(ww, r)
		if ww.Code != http.StatusNoContent {
			t.Fatalf("expected 204, got %d: %s", ww.Code, ww.Body)
		}
	}

	// Note should be back in normal GET.
	req2 := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/notes/%d", id), nil)
	req2.SetPathValue("id", fmt.Sprintf("%d", id))
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.Get(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 after unarchive, got %d", w2.Code)
	}
}

func TestHandler_Create_TitleTooLong(t *testing.T) {
	h, user := newHandlerFixture(t)
	longTitle := fmt.Sprintf(`{"title":"%s","body":"x"}`, string(make([]byte, 501)))
	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewBufferString(longTitle))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for long title, got %d", w.Code)
	}
}

func TestHandler_Create_BodyTooLong(t *testing.T) {
	h, user := newHandlerFixture(t)
	longBody, _ := json.Marshal(map[string]string{"title": "t", "body": string(make([]byte, 500_001))})
	req := httptest.NewRequest(http.MethodPost, "/api/notes", bytes.NewReader(longBody))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for long body, got %d", w.Code)
	}
}

func TestHandler_Update_TitleTooLong(t *testing.T) {
	h, user := newHandlerFixture(t)
	ctx := context.Background()
	note, _ := notes.NewService(notes.NewRepo(func() *db.DB {
		database, _ := db.Open(db.Config{SQLitePath: ":memory:"})
		return database
	}())).Create(ctx, user.ID, "ok", "ok")
	_ = note

	// Create a note first via the handler so we have an ID in this DB.
	createReq := httptest.NewRequest(http.MethodPost, "/api/notes",
		bytes.NewBufferString(`{"title":"ok","body":"ok"}`))
	createReq.Header.Set("Content-Type", "application/json")
	createReq = withUser(createReq, user)
	cw := httptest.NewRecorder()
	h.Create(cw, createReq)
	var created map[string]any
	json.NewDecoder(cw.Body).Decode(&created) //nolint:errcheck
	id := int64(created["id"].(float64))

	longTitle := string(make([]byte, 501))
	body, _ := json.Marshal(map[string]string{"title": longTitle})
	req := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/notes/%d", id), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", fmt.Sprintf("%d", id))
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Update(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for long title in update, got %d", w.Code)
	}
}

func TestNotesHandler_ResponseOmitsUserID(t *testing.T) {
	h, user := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/notes",
		bytes.NewBufferString(`{"title":"secret","body":"content"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)

	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp) //nolint:errcheck
	if _, ok := resp["user_id"]; ok {
		t.Fatal("user_id must not be present in note response")
	}
}

// List honours the ?limit= query parameter. Issue #18.
func TestNotesHandler_List_RespectsLimit(t *testing.T) {
	h, user := newHandlerFixture(t)

	// Create three notes.
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/notes",
			bytes.NewBufferString(fmt.Sprintf(`{"title":"n%d"}`, i)))
		req.Header.Set("Content-Type", "application/json")
		req = withUser(req, user)
		h.Create(httptest.NewRecorder(), req)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/notes?limit=2", nil)
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.List(w, req)

	var resp []map[string]any
	json.NewDecoder(w.Body).Decode(&resp) //nolint:errcheck
	if len(resp) != 2 {
		t.Fatalf("expected 2 notes with limit=2, got %d", len(resp))
	}
}

// Limits beyond the server maximum are clamped so an attacker cannot override
// the safety default by passing a huge limit.
func TestNotesHandler_List_ClampsExcessiveLimit(t *testing.T) {
	h, user := newHandlerFixture(t)

	// Create 150 notes (over the MaxPageSize of 100).
	for i := 0; i < 150; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/notes",
			bytes.NewBufferString(fmt.Sprintf(`{"title":"n%d"}`, i)))
		req.Header.Set("Content-Type", "application/json")
		req = withUser(req, user)
		h.Create(httptest.NewRecorder(), req)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/notes?limit=9999", nil)
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.List(w, req)

	var resp []map[string]any
	json.NewDecoder(w.Body).Decode(&resp) //nolint:errcheck
	if len(resp) != 100 { // MaxPageSize from httpx
		t.Fatalf("expected response clamped to 100, got %d", len(resp))
	}
}
