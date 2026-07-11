package client_test

import (
	"bytes"
	"context"
	"net/http"
	"testing"
)

func TestListTrashReturnsEntriesWithPurgeDeadline(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK,
		`[{"note_id":7,"title":"Old","deleted_at":"2026-01-01T00:00:00Z",
		   "permanent_delete_at":"2026-01-08T00:00:00Z"}]`)

	entries, err := c.ListTrash(context.Background(), 0, 0)
	if err != nil {
		t.Fatalf("ListTrash: %v", err)
	}
	if rec.Method != http.MethodGet || rec.Path != "/api/trash" {
		t.Errorf("request = %s %s, want GET /api/trash", rec.Method, rec.Path)
	}
	if len(entries) != 1 || entries[0].NoteID != 7 || entries[0].PermanentDeleteAt == "" {
		t.Errorf("unexpected entries: %+v", entries)
	}
}

func TestRestoreNotePostsRestore(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusNoContent, "")

	if err := c.RestoreNote(context.Background(), 7); err != nil {
		t.Fatalf("RestoreNote: %v", err)
	}
	if rec.Method != http.MethodPost || rec.Path != "/api/trash/7/restore" {
		t.Errorf("request = %s %s, want POST /api/trash/7/restore", rec.Method, rec.Path)
	}
}

func TestPurgeNoteDeletesPermanently(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusNoContent, "")

	if err := c.PurgeNote(context.Background(), 7); err != nil {
		t.Fatalf("PurgeNote: %v", err)
	}
	if rec.Method != http.MethodDelete || rec.Path != "/api/trash/7" {
		t.Errorf("request = %s %s, want DELETE /api/trash/7", rec.Method, rec.Path)
	}
}

func TestEmptyTrashDeletesEverything(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusNoContent, "")

	if err := c.EmptyTrash(context.Background()); err != nil {
		t.Fatalf("EmptyTrash: %v", err)
	}
	if rec.Method != http.MethodDelete || rec.Path != "/api/trash" {
		t.Errorf("request = %s %s, want DELETE /api/trash", rec.Method, rec.Path)
	}
}

func TestListTokensReturnsTokenMetadataWithoutSecrets(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK,
		`[{"id":1,"name":"laptop","prefix":"cnp_abc12345","scope":"read_write",
		   "created_at":"2026-01-01T00:00:00Z"}]`)

	tokens, err := c.ListTokens(context.Background())
	if err != nil {
		t.Fatalf("ListTokens: %v", err)
	}
	if rec.Method != http.MethodGet || rec.Path != "/api/tokens" {
		t.Errorf("request = %s %s, want GET /api/tokens", rec.Method, rec.Path)
	}
	if len(tokens) != 1 || tokens[0].Scope != "read_write" || tokens[0].Prefix != "cnp_abc12345" {
		t.Errorf("unexpected tokens: %+v", tokens)
	}
}

func TestRevokeTokenDeletesByID(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusNoContent, "")

	if err := c.RevokeToken(context.Background(), 1); err != nil {
		t.Fatalf("RevokeToken: %v", err)
	}
	if rec.Method != http.MethodDelete || rec.Path != "/api/tokens/1" {
		t.Errorf("request = %s %s, want DELETE /api/tokens/1", rec.Method, rec.Path)
	}
}

func TestRevokeAllTokensPostsRevokeAll(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusNoContent, "")

	if err := c.RevokeAllTokens(context.Background()); err != nil {
		t.Fatalf("RevokeAllTokens: %v", err)
	}
	if rec.Method != http.MethodPost || rec.Path != "/api/tokens/revoke-all" {
		t.Errorf("request = %s %s, want POST /api/tokens/revoke-all", rec.Method, rec.Path)
	}
}

func TestExportStreamsZipToWriter(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK, "PK\x03\x04fakezip")

	var buf bytes.Buffer
	if err := c.Export(context.Background(), "secret", &buf); err != nil {
		t.Fatalf("Export: %v", err)
	}
	if rec.Method != http.MethodPost || rec.Path != "/api/export" {
		t.Errorf("request = %s %s, want POST /api/export", rec.Method, rec.Path)
	}
	if !bytes.Contains(rec.Body, []byte(`"password":"secret"`)) {
		t.Errorf("request body %q should carry the password", rec.Body)
	}
	if !bytes.HasPrefix(buf.Bytes(), []byte("PK")) {
		t.Errorf("exported bytes = %q, want ZIP stream", buf.Bytes())
	}
}
