package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// Export streams a ZIP of all non-trashed notes (with bundled images) into w.
// A non-empty password encrypts the ZIP server-side.
func (c *Client) Export(ctx context.Context, password string, w io.Writer) error {
	payload, err := json.Marshal(struct {
		Password string `json:"password"`
	}{password})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/export",
		strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
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
	_, err = io.Copy(w, resp.Body)
	return err
}
