package tags_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/tags"
)

var _ = context.Background // keep import for newHandlerFixture

func newHandlerFixture(t *testing.T) (*tags.Handler, *auth.User, *db.DB) {
	t.Helper()
	database := openTestDB(t)
	userRepo := auth.NewUserRepo(database)
	user, err := userRepo.Create(context.Background(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	h := tags.NewHandler(tags.NewService(tags.NewRepo(database)))
	return h, user, database
}

func withUser(r *http.Request, u *auth.User) *http.Request {
	return r.WithContext(auth.WithUser(r.Context(), u))
}

func TestTagsHandler_CreateAndList(t *testing.T) {
	h, user, _ := newHandlerFixture(t)

	// Create
	req := httptest.NewRequest(http.MethodPost, "/api/tags",
		bytes.NewBufferString(`{"name":"work"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("Create: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	// List
	req2 := httptest.NewRequest(http.MethodGet, "/api/tags", nil)
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.List(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("List: expected 200, got %d", w2.Code)
	}
	var list []any
	json.NewDecoder(w2.Body).Decode(&list) //nolint:errcheck
	if len(list) != 1 {
		t.Fatalf("expected 1 tag, got %d", len(list))
	}
}

func TestTagsHandler_Rename(t *testing.T) {
	h, user, _ := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/tags",
		bytes.NewBufferString(`{"name":"old"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("Create: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	id := int64(created["id"].(float64))

	req2 := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/tags/%d", id),
		bytes.NewBufferString(`{"name":"new"}`))
	req2.Header.Set("Content-Type", "application/json")
	req2.SetPathValue("id", fmt.Sprintf("%d", id))
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.Rename(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("Rename: expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
	var resp map[string]any
	json.NewDecoder(w2.Body).Decode(&resp) //nolint:errcheck
	if resp["name"] != "new" {
		t.Fatalf("expected name=new, got %v", resp["name"])
	}
}

func TestTagsHandler_Delete(t *testing.T) {
	h, user, _ := newHandlerFixture(t)

	req := httptest.NewRequest(http.MethodPost, "/api/tags",
		bytes.NewBufferString(`{"name":"temp"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	id := int64(created["id"].(float64))

	req2 := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/tags/%d", id), nil)
	req2.SetPathValue("id", fmt.Sprintf("%d", id))
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.Delete(w2, req2)

	if w2.Code != http.StatusNoContent {
		t.Fatalf("Delete: expected 204, got %d", w2.Code)
	}
}

func TestTagsHandler_NoteAssociations(t *testing.T) {
	h, user, database := newHandlerFixture(t)
	noteID := seedNote(t, database, user.ID, "My Note")

	// Create tag
	req := httptest.NewRequest(http.MethodPost, "/api/tags",
		bytes.NewBufferString(`{"name":"label"}`))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.Create(w, req)
	var created map[string]any
	json.NewDecoder(w.Body).Decode(&created) //nolint:errcheck
	tagID := int64(created["id"].(float64))

	// Add to note
	body := fmt.Sprintf(`{"tag_id":%d}`, tagID)
	req2 := httptest.NewRequest(http.MethodPost,
		fmt.Sprintf("/api/notes/%d/tags", noteID),
		bytes.NewBufferString(body))
	req2.Header.Set("Content-Type", "application/json")
	req2.SetPathValue("id", fmt.Sprintf("%d", noteID))
	req2 = withUser(req2, user)
	w2 := httptest.NewRecorder()
	h.AddToNote(w2, req2)

	if w2.Code != http.StatusNoContent {
		t.Fatalf("AddToNote: expected 204, got %d: %s", w2.Code, w2.Body.String())
	}

	// Remove from note
	req3 := httptest.NewRequest(http.MethodDelete,
		fmt.Sprintf("/api/notes/%d/tags/%d", noteID, tagID), nil)
	req3.SetPathValue("id", fmt.Sprintf("%d", noteID))
	req3.SetPathValue("tid", fmt.Sprintf("%d", tagID))
	req3 = withUser(req3, user)
	w3 := httptest.NewRecorder()
	h.RemoveFromNote(w3, req3)

	if w3.Code != http.StatusNoContent {
		t.Fatalf("RemoveFromNote: expected 204, got %d", w3.Code)
	}
}
