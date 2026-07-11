package client_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/cli/client"
)

// newTestServer returns a client pointed at an httptest.Server that responds
// to a single expected method+path with the given status and JSON body, and
// records the last request seen for header/query assertions.
func newTestServer(t *testing.T, status int, body string) (*client.Client, *http.Request) {
	t.Helper()
	last := &http.Request{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*last = *r.Clone(r.Context())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return client.New(srv.URL, "cnp_testtoken"), last
}

func TestListNotesSendsBearerTokenAndParsesNotes(t *testing.T) {
	c, last := newTestServer(t, http.StatusOK, `[
		{"id":1,"title":"First","body":"hello world","starred":true,"pinned":false,
		 "archived":false,"created_at":"2026-01-02T03:04:05Z","updated_at":"2026-01-02T03:04:05Z"}
	]`)

	notes, err := c.ListNotes(context.Background(), client.ListNotesOptions{})
	if err != nil {
		t.Fatalf("ListNotes: %v", err)
	}

	if got := last.Header.Get("Authorization"); got != "Bearer cnp_testtoken" {
		t.Errorf("Authorization header = %q, want %q", got, "Bearer cnp_testtoken")
	}
	if last.Method != http.MethodGet || last.URL.Path != "/api/notes" {
		t.Errorf("request = %s %s, want GET /api/notes", last.Method, last.URL.Path)
	}
	if len(notes) != 1 {
		t.Fatalf("got %d notes, want 1", len(notes))
	}
	n := notes[0]
	if n.ID != 1 || n.Title != "First" || n.Body != "hello world" || !n.Starred {
		t.Errorf("unexpected note: %+v", n)
	}
}

func TestNon2xxResponsesBecomeAPIErrorsWithServerMessage(t *testing.T) {
	c, _ := newTestServer(t, http.StatusUnauthorized, `{"error":"invalid api token"}`)

	_, err := c.ListNotes(context.Background(), client.ListNotesOptions{})

	var apiErr *client.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("want *client.APIError, got %T: %v", err, err)
	}
	if apiErr.StatusCode != http.StatusUnauthorized || apiErr.Message != "invalid api token" {
		t.Errorf("got %+v, want 401 / invalid api token", apiErr)
	}
}
