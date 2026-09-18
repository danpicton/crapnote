package client_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/cli/client"
)

func TestLockedArchiveAndDeleteSurfaceServerError(t *testing.T) {
	for _, tc := range []struct {
		name string
		op   func(context.Context, int64) error
	}{
		{name: "archive", op: func(ctx context.Context, id int64) error {
			c, _ := newRecordingServer(t, http.StatusLocked, `{"error":"note is locked; unlock it first"}`)
			return c.ArchiveNote(ctx, id)
		}},
		{name: "delete", op: func(ctx context.Context, id int64) error {
			c, _ := newRecordingServer(t, http.StatusLocked, `{"error":"note is locked; unlock it first"}`)
			return c.DeleteNote(ctx, id)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.op(context.Background(), 7)
			var apiErr *client.APIError
			if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusLocked {
				t.Fatalf("error = %v, want APIError status 423", err)
			}
			if !strings.Contains(err.Error(), "unlock it first") {
				t.Fatalf("error = %q, want unlock guidance", err)
			}
		})
	}
}

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
