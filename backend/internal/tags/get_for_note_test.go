package tags_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/internal/tags"
)

func TestTagsHandler_GetForNote(t *testing.T) {
	h, user, database := newHandlerFixture(t)
	repo := tags.NewRepo(database)
	noteID := seedNote(t, database, user.ID, "My Note")
	ctx := context.Background()

	second, err := repo.Create(ctx, user.ID, "zebra")
	if err != nil {
		t.Fatalf("create second tag: %v", err)
	}
	first, err := repo.Create(ctx, user.ID, "alpha")
	if err != nil {
		t.Fatalf("create first tag: %v", err)
	}
	if err := repo.AddToNote(ctx, noteID, second.ID, user.ID); err != nil {
		t.Fatalf("add second tag: %v", err)
	}
	if err := repo.AddToNote(ctx, noteID, first.ID, user.ID); err != nil {
		t.Fatalf("add first tag: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/notes/%d/tags", noteID), nil)
	req.SetPathValue("id", fmt.Sprint(noteID))
	req = withUser(req, user)
	w := httptest.NewRecorder()
	h.GetForNote(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GetForNote: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got) != 2 || got[0].ID != first.ID || got[0].Name != "alpha" || got[1].ID != second.ID {
		t.Fatalf("tags = %+v, want alpha then zebra", got)
	}
}

func TestTagsHandler_GetForNoteDoesNotLeakAnotherUsersTags(t *testing.T) {
	h, owner, database := newHandlerFixture(t)
	repo := tags.NewRepo(database)
	ctx := context.Background()
	noteID := seedNote(t, database, owner.ID, "Private")
	tag, err := repo.Create(ctx, owner.ID, "private-tag")
	if err != nil {
		t.Fatalf("create tag: %v", err)
	}
	if err := repo.AddToNote(ctx, noteID, tag.ID, owner.ID); err != nil {
		t.Fatalf("add tag: %v", err)
	}

	other := *owner
	other.ID++
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/notes/%d/tags", noteID), nil)
	req.SetPathValue("id", fmt.Sprint(noteID))
	req = withUser(req, &other)
	w := httptest.NewRecorder()
	h.GetForNote(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GetForNote: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got []json.RawMessage
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("other user received %d tags: %s", len(got), w.Body.String())
	}
}

func TestTagsHandler_GetForNoteRejectsInvalidOrMissingIdentity(t *testing.T) {
	h, user, _ := newHandlerFixture(t)

	tests := []struct {
		name     string
		id       string
		withUser bool
		want     int
	}{
		{name: "invalid note id", id: "not-a-number", withUser: true, want: http.StatusBadRequest},
		{name: "unauthenticated", id: "1", withUser: false, want: http.StatusUnauthorized},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/notes/"+tt.id+"/tags", nil)
			req.SetPathValue("id", tt.id)
			if tt.withUser {
				req = withUser(req, user)
			}
			w := httptest.NewRecorder()

			h.GetForNote(w, req)

			if w.Code != tt.want {
				t.Errorf("status = %d, want %d: %s", w.Code, tt.want, w.Body.String())
			}
		})
	}
}
