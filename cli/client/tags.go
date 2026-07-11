package client

import (
	"context"
	"net/http"
	"strconv"
)

// Tag mirrors the server's tag response shape. NoteCount is populated only
// by ListTags.
type Tag struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	NoteCount int    `json:"note_count,omitempty"`
	CreatedAt string `json:"created_at"`
}

// ListTags returns the caller's tags with per-tag note counts.
// limit/offset <= 0 use server defaults.
func (c *Client) ListTags(ctx context.Context, limit, offset int) ([]Tag, error) {
	var tags []Tag
	if err := c.do(ctx, http.MethodGet, "/api/tags", pageQuery(limit, offset), nil, &tags); err != nil {
		return nil, err
	}
	return tags, nil
}

// CreateTag creates a tag with the given name.
func (c *Client) CreateTag(ctx context.Context, name string) (*Tag, error) {
	req := struct {
		Name string `json:"name"`
	}{name}
	var tag Tag
	if err := c.do(ctx, http.MethodPost, "/api/tags", nil, req, &tag); err != nil {
		return nil, err
	}
	return &tag, nil
}

// RenameTag changes a tag's name.
func (c *Client) RenameTag(ctx context.Context, id int64, name string) (*Tag, error) {
	req := struct {
		Name string `json:"name"`
	}{name}
	var tag Tag
	if err := c.do(ctx, http.MethodPut, tagPath(id), nil, req, &tag); err != nil {
		return nil, err
	}
	return &tag, nil
}

// DeleteTag removes a tag (and its note associations).
func (c *Client) DeleteTag(ctx context.Context, id int64) error {
	return c.do(ctx, http.MethodDelete, tagPath(id), nil, nil, nil)
}

// NoteTags lists the tags attached to a note.
func (c *Client) NoteTags(ctx context.Context, noteID int64) ([]Tag, error) {
	var tags []Tag
	if err := c.do(ctx, http.MethodGet, notePath(noteID)+"/tags", nil, nil, &tags); err != nil {
		return nil, err
	}
	return tags, nil
}

// TagNote attaches an existing tag to a note.
func (c *Client) TagNote(ctx context.Context, noteID, tagID int64) error {
	req := struct {
		TagID int64 `json:"tag_id"`
	}{tagID}
	return c.do(ctx, http.MethodPost, notePath(noteID)+"/tags", nil, req, nil)
}

// UntagNote removes a tag from a note.
func (c *Client) UntagNote(ctx context.Context, noteID, tagID int64) error {
	return c.do(ctx, http.MethodDelete, notePath(noteID)+"/tags/"+strconv.FormatInt(tagID, 10), nil, nil, nil)
}

func tagPath(id int64) string {
	return "/api/tags/" + strconv.FormatInt(id, 10)
}
