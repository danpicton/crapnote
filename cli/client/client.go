// Package client is a typed Go client for the CrapNote REST API.
//
// It is a pure HTTP client: authentication is an Authorization: Bearer
// header carrying a cnp_ API token; all request/response shapes mirror the
// server's JSON contract. The CLI in cmd/crapnote is one frontend over this
// package; an MCP server could be another.
package client

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Client calls the CrapNote API at a base URL using a bearer token.
type Client struct {
	baseURL string
	token   string
	httpc   *http.Client
}

// New creates a Client. baseURL is the server root (e.g.
// "http://localhost:8080"); token is a cnp_ API token, or empty for
// unauthenticated calls (which the server will reject with 401).
func New(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		httpc:   http.DefaultClient,
	}
}

// Note mirrors the server's note response shape.
type Note struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Starred   bool   `json:"starred"`
	Pinned    bool   `json:"pinned"`
	Archived  bool   `json:"archived"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// ListNotesOptions are the filters accepted by GET /api/notes.
type ListNotesOptions struct {
	Starred bool   // only starred notes
	TagID   int64  // >0: only notes with this tag
	Search  string // FTS5 full-text query
	Limit   int    // >0: page size (server caps at 100)
	Offset  int    // >0: page offset
}

// ListNotes returns the caller's active notes, optionally filtered.
func (c *Client) ListNotes(ctx context.Context, opts ListNotesOptions) ([]Note, error) {
	q := url.Values{}
	if opts.Starred {
		q.Set("starred", "true")
	}
	if opts.TagID > 0 {
		q.Set("tag", strconv.FormatInt(opts.TagID, 10))
	}
	if opts.Search != "" {
		q.Set("search", opts.Search)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Offset > 0 {
		q.Set("offset", strconv.Itoa(opts.Offset))
	}
	var notes []Note
	if err := c.do(ctx, http.MethodGet, "/api/notes", q, nil, &notes); err != nil {
		return nil, err
	}
	return notes, nil
}

// do performs an API request. body (if non-nil) is JSON-encoded; out (if
// non-nil) receives the decoded JSON response. Non-2xx responses become
// *APIError.
func (c *Client) do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	u := c.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}

	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
		reqBody = strings.NewReader(string(b))
	}

	req, err := http.NewRequestWithContext(ctx, method, u, reqBody)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close() //nolint:errcheck

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return errorFromResponse(resp)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}
