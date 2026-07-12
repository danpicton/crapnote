package client_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

const tagJSON = `{"id":3,"name":"work","created_at":"2026-01-01T00:00:00Z"}`

func TestListTagsReturnsTagsWithNoteCounts(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK,
		`[{"id":3,"name":"work","note_count":5,"created_at":"2026-01-01T00:00:00Z"}]`)

	tags, err := c.ListTags(context.Background(), 0, 0)
	if err != nil {
		t.Fatalf("ListTags: %v", err)
	}
	if rec.Method != http.MethodGet || rec.Path != "/api/tags" {
		t.Errorf("request = %s %s, want GET /api/tags", rec.Method, rec.Path)
	}
	if len(tags) != 1 || tags[0].Name != "work" || tags[0].NoteCount != 5 {
		t.Errorf("unexpected tags: %+v", tags)
	}
}

func TestCreateTagPostsName(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusCreated, tagJSON)

	tag, err := c.CreateTag(context.Background(), "work")
	if err != nil {
		t.Fatalf("CreateTag: %v", err)
	}
	if rec.Method != http.MethodPost || rec.Path != "/api/tags" {
		t.Errorf("request = %s %s, want POST /api/tags", rec.Method, rec.Path)
	}
	var sent map[string]string
	_ = json.Unmarshal(rec.Body, &sent)
	if sent["name"] != "work" {
		t.Errorf("sent %v, want name=work", sent)
	}
	if tag.ID != 3 {
		t.Errorf("tag.ID = %d, want 3", tag.ID)
	}
}

func TestRenameTagPutsNewName(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK, tagJSON)

	if _, err := c.RenameTag(context.Background(), 3, "life"); err != nil {
		t.Fatalf("RenameTag: %v", err)
	}
	if rec.Method != http.MethodPut || rec.Path != "/api/tags/3" {
		t.Errorf("request = %s %s, want PUT /api/tags/3", rec.Method, rec.Path)
	}
}

func TestDeleteTag(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusNoContent, "")

	if err := c.DeleteTag(context.Background(), 3); err != nil {
		t.Fatalf("DeleteTag: %v", err)
	}
	if rec.Method != http.MethodDelete || rec.Path != "/api/tags/3" {
		t.Errorf("request = %s %s, want DELETE /api/tags/3", rec.Method, rec.Path)
	}
}

func TestNoteTagsListsTagsForNote(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK, `[`+tagJSON+`]`)

	tags, err := c.NoteTags(context.Background(), 7)
	if err != nil {
		t.Fatalf("NoteTags: %v", err)
	}
	if rec.Method != http.MethodGet || rec.Path != "/api/notes/7/tags" {
		t.Errorf("request = %s %s, want GET /api/notes/7/tags", rec.Method, rec.Path)
	}
	if len(tags) != 1 {
		t.Errorf("got %d tags, want 1", len(tags))
	}
}

func TestTagNotePostsTagID(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusNoContent, "")

	if err := c.TagNote(context.Background(), 7, 3); err != nil {
		t.Fatalf("TagNote: %v", err)
	}
	if rec.Method != http.MethodPost || rec.Path != "/api/notes/7/tags" {
		t.Errorf("request = %s %s, want POST /api/notes/7/tags", rec.Method, rec.Path)
	}
	var sent map[string]int64
	_ = json.Unmarshal(rec.Body, &sent)
	if sent["tag_id"] != 3 {
		t.Errorf("sent %v, want tag_id=3", sent)
	}
}

func TestUntagNoteDeletesAssociation(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusNoContent, "")

	if err := c.UntagNote(context.Background(), 7, 3); err != nil {
		t.Fatalf("UntagNote: %v", err)
	}
	if rec.Method != http.MethodDelete || rec.Path != "/api/notes/7/tags/3" {
		t.Errorf("request = %s %s, want DELETE /api/notes/7/tags/3", rec.Method, rec.Path)
	}
}
