package client_test

import (
	"context"
	"net/http"
	"testing"
)

func TestToggleLockPatchesLockEndpoint(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK, `{
		"id":7,"title":"T","body":"B","starred":false,"pinned":false,"locked":true,
		"archived":false,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"
	}`)

	note, err := c.ToggleLock(context.Background(), 7)
	if err != nil {
		t.Fatalf("ToggleLock: %v", err)
	}
	if rec.Method != http.MethodPatch || rec.Path != "/api/notes/7/lock" {
		t.Errorf("request = %s %s, want PATCH /api/notes/7/lock", rec.Method, rec.Path)
	}
	if !note.Locked {
		t.Error("note.Locked = false, want true after toggle")
	}
}
