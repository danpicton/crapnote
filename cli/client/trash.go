package client

import (
	"context"
	"net/http"
	"strconv"
)

// TrashEntry mirrors the server's trash listing shape. PermanentDeleteAt is
// when the background job will purge the note for good.
type TrashEntry struct {
	NoteID            int64  `json:"note_id"`
	Title             string `json:"title"`
	DeletedAt         string `json:"deleted_at"`
	PermanentDeleteAt string `json:"permanent_delete_at"`
}

// ListTrash returns trashed notes. limit/offset <= 0 use server defaults.
func (c *Client) ListTrash(ctx context.Context, limit, offset int) ([]TrashEntry, error) {
	var entries []TrashEntry
	if err := c.do(ctx, http.MethodGet, "/api/trash", pageQuery(limit, offset), nil, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

// RestoreNote moves a trashed note back to the active list.
func (c *Client) RestoreNote(ctx context.Context, noteID int64) error {
	return c.do(ctx, http.MethodPost, trashPath(noteID)+"/restore", nil, nil, nil)
}

// PurgeNote permanently deletes a single trashed note. Irreversible.
func (c *Client) PurgeNote(ctx context.Context, noteID int64) error {
	return c.do(ctx, http.MethodDelete, trashPath(noteID), nil, nil, nil)
}

// EmptyTrash permanently deletes every trashed note. Irreversible.
func (c *Client) EmptyTrash(ctx context.Context) error {
	return c.do(ctx, http.MethodDelete, "/api/trash", nil, nil, nil)
}

func trashPath(id int64) string {
	return "/api/trash/" + strconv.FormatInt(id, 10)
}
