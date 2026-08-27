package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
)

// CreateNote creates a note and returns the server's representation.
func (c *Client) CreateNote(ctx context.Context, title, body string) (*Note, error) {
	req := struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}{title, body}
	var n Note
	if err := c.do(ctx, http.MethodPost, "/api/notes", nil, req, &n); err != nil {
		return nil, err
	}
	return &n, nil
}

// GetNote fetches a single note by ID.
func (c *Client) GetNote(ctx context.Context, id int64) (*Note, error) {
	var n Note
	if err := c.do(ctx, http.MethodGet, notePath(id), nil, nil, &n); err != nil {
		return nil, err
	}
	return &n, nil
}

// UpdateNote updates a note's title and/or body. Nil fields are omitted from
// the request and left unchanged by the server.
func (c *Client) UpdateNote(ctx context.Context, id int64, title, body *string) (*Note, error) {
	req := struct {
		Title *string `json:"title,omitempty"`
		Body  *string `json:"body,omitempty"`
	}{title, body}
	var n Note
	if err := c.do(ctx, http.MethodPut, notePath(id), nil, req, &n); err != nil {
		return nil, err
	}
	return &n, nil
}

// DeleteNote moves a note to the trash (recoverable via RestoreNote).
func (c *Client) DeleteNote(ctx context.Context, id int64) error {
	return c.do(ctx, http.MethodDelete, notePath(id), nil, nil, nil)
}

// ToggleStar flips the note's starred flag and returns the updated note.
func (c *Client) ToggleStar(ctx context.Context, id int64) (*Note, error) {
	return c.patchNote(ctx, id, "star")
}

// TogglePin flips the note's pinned flag and returns the updated note.
func (c *Client) TogglePin(ctx context.Context, id int64) (*Note, error) {
	return c.patchNote(ctx, id, "pin")
}

// ToggleLock flips the note's locked flag and returns the updated note.
func (c *Client) ToggleLock(ctx context.Context, id int64) (*Note, error) {
	return c.patchNote(ctx, id, "lock")
}

// ArchiveNote moves a note to the archive.
func (c *Client) ArchiveNote(ctx context.Context, id int64) error {
	return c.do(ctx, http.MethodPatch, notePath(id)+"/archive", nil, nil, nil)
}

// UnarchiveNote returns an archived note to the active list.
func (c *Client) UnarchiveNote(ctx context.Context, id int64) error {
	return c.do(ctx, http.MethodPatch, notePath(id)+"/unarchive", nil, nil, nil)
}

// ListArchived returns archived notes. limit/offset <= 0 use server defaults.
func (c *Client) ListArchived(ctx context.Context, limit, offset int) ([]Note, error) {
	var notes []Note
	if err := c.do(ctx, http.MethodGet, "/api/archive", pageQuery(limit, offset), nil, &notes); err != nil {
		return nil, err
	}
	return notes, nil
}

func (c *Client) patchNote(ctx context.Context, id int64, action string) (*Note, error) {
	var n Note
	if err := c.do(ctx, http.MethodPatch, fmt.Sprintf("%s/%s", notePath(id), action), nil, nil, &n); err != nil {
		return nil, err
	}
	return &n, nil
}

func notePath(id int64) string {
	return "/api/notes/" + strconv.FormatInt(id, 10)
}

func pageQuery(limit, offset int) url.Values {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		q.Set("offset", strconv.Itoa(offset))
	}
	return q
}
