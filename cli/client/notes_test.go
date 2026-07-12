package client_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/cli/client"
)

// recordingServer captures method, path, and body of the last request and
// replies with a fixed status/body.
type recordedRequest struct {
	Method string
	Path   string
	Query  string
	Body   []byte
}

func newRecordingServer(t *testing.T, status int, respBody string) (*client.Client, *recordedRequest) {
	t.Helper()
	rec := &recordedRequest{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.Method = r.Method
		rec.Path = r.URL.Path
		rec.Query = r.URL.RawQuery
		rec.Body, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(respBody))
	}))
	t.Cleanup(srv.Close)
	return client.New(srv.URL, "cnp_testtoken"), rec
}

const noteJSON = `{"id":7,"title":"T","body":"B","starred":false,"pinned":false,
	"archived":false,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}`

func TestCreateNotePostsTitleAndBody(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusCreated, noteJSON)

	note, err := c.CreateNote(context.Background(), "T", "B")
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	if rec.Method != http.MethodPost || rec.Path != "/api/notes" {
		t.Errorf("request = %s %s, want POST /api/notes", rec.Method, rec.Path)
	}
	var sent map[string]string
	if err := json.Unmarshal(rec.Body, &sent); err != nil {
		t.Fatalf("request body not JSON: %v", err)
	}
	if sent["title"] != "T" || sent["body"] != "B" {
		t.Errorf("sent %v, want title=T body=B", sent)
	}
	if note.ID != 7 {
		t.Errorf("note.ID = %d, want 7", note.ID)
	}
}

func TestGetNoteFetchesByID(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK, noteJSON)

	note, err := c.GetNote(context.Background(), 7)
	if err != nil {
		t.Fatalf("GetNote: %v", err)
	}
	if rec.Method != http.MethodGet || rec.Path != "/api/notes/7" {
		t.Errorf("request = %s %s, want GET /api/notes/7", rec.Method, rec.Path)
	}
	if note.Title != "T" {
		t.Errorf("note.Title = %q, want T", note.Title)
	}
}

func TestUpdateNoteSendsOnlyProvidedFields(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK, noteJSON)

	title := "New"
	if _, err := c.UpdateNote(context.Background(), 7, &title, nil); err != nil {
		t.Fatalf("UpdateNote: %v", err)
	}
	if rec.Method != http.MethodPut || rec.Path != "/api/notes/7" {
		t.Errorf("request = %s %s, want PUT /api/notes/7", rec.Method, rec.Path)
	}
	var sent map[string]any
	if err := json.Unmarshal(rec.Body, &sent); err != nil {
		t.Fatalf("request body not JSON: %v", err)
	}
	if sent["title"] != "New" {
		t.Errorf("title sent = %v, want New", sent["title"])
	}
	if _, present := sent["body"]; present {
		t.Errorf("body should be omitted when nil, sent %v", sent)
	}
}

func TestDeleteNoteMovesToTrash(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusNoContent, "")

	if err := c.DeleteNote(context.Background(), 7); err != nil {
		t.Fatalf("DeleteNote: %v", err)
	}
	if rec.Method != http.MethodDelete || rec.Path != "/api/notes/7" {
		t.Errorf("request = %s %s, want DELETE /api/notes/7", rec.Method, rec.Path)
	}
}

func TestToggleStarPatchesAndReturnsUpdatedNote(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK,
		`{"id":7,"title":"T","body":"B","starred":true,"pinned":false,"archived":false,
		  "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}`)

	note, err := c.ToggleStar(context.Background(), 7)
	if err != nil {
		t.Fatalf("ToggleStar: %v", err)
	}
	if rec.Method != http.MethodPatch || rec.Path != "/api/notes/7/star" {
		t.Errorf("request = %s %s, want PATCH /api/notes/7/star", rec.Method, rec.Path)
	}
	if !note.Starred {
		t.Error("note.Starred = false, want true after toggle")
	}
}

func TestTogglePinPatchesPinEndpoint(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK, noteJSON)

	if _, err := c.TogglePin(context.Background(), 7); err != nil {
		t.Fatalf("TogglePin: %v", err)
	}
	if rec.Method != http.MethodPatch || rec.Path != "/api/notes/7/pin" {
		t.Errorf("request = %s %s, want PATCH /api/notes/7/pin", rec.Method, rec.Path)
	}
}

func TestArchiveAndUnarchiveNote(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusNoContent, "")

	if err := c.ArchiveNote(context.Background(), 7); err != nil {
		t.Fatalf("ArchiveNote: %v", err)
	}
	if rec.Method != http.MethodPatch || rec.Path != "/api/notes/7/archive" {
		t.Errorf("request = %s %s, want PATCH /api/notes/7/archive", rec.Method, rec.Path)
	}

	if err := c.UnarchiveNote(context.Background(), 7); err != nil {
		t.Fatalf("UnarchiveNote: %v", err)
	}
	if rec.Path != "/api/notes/7/unarchive" {
		t.Errorf("path = %s, want /api/notes/7/unarchive", rec.Path)
	}
}

func TestListArchivedUsesArchiveEndpoint(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK, `[`+noteJSON+`]`)

	notes, err := c.ListArchived(context.Background(), 25, 50)
	if err != nil {
		t.Fatalf("ListArchived: %v", err)
	}
	if rec.Method != http.MethodGet || rec.Path != "/api/archive" {
		t.Errorf("request = %s %s, want GET /api/archive", rec.Method, rec.Path)
	}
	if rec.Query != "limit=25&offset=50" {
		t.Errorf("query = %q, want limit=25&offset=50", rec.Query)
	}
	if len(notes) != 1 {
		t.Errorf("got %d notes, want 1", len(notes))
	}
}

func TestNotFoundSurfacesAs404APIError(t *testing.T) {
	c, _ := newRecordingServer(t, http.StatusNotFound, `{"error":"note not found"}`)

	_, err := c.GetNote(context.Background(), 999)
	var apiErr *client.APIError
	if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404 APIError, got %v", err)
	}
}
