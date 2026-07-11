package client

import (
	"context"
	"net/http"
	"strconv"
)

// APIToken mirrors the server's token metadata shape. Raw secrets are never
// returned by the list endpoint; Prefix is the display prefix only.
type APIToken struct {
	ID         int64   `json:"id"`
	Name       string  `json:"name"`
	Prefix     string  `json:"prefix"`
	Scope      string  `json:"scope"` // "read" or "read_write"
	LastUsedAt *string `json:"last_used_at,omitempty"`
	ExpiresAt  *string `json:"expires_at,omitempty"`
	RevokedAt  *string `json:"revoked_at,omitempty"`
	CreatedAt  string  `json:"created_at"`
}

// ListTokens returns the caller's API tokens (metadata only, no secrets).
func (c *Client) ListTokens(ctx context.Context) ([]APIToken, error) {
	var tokens []APIToken
	if err := c.do(ctx, http.MethodGet, "/api/tokens", nil, nil, &tokens); err != nil {
		return nil, err
	}
	return tokens, nil
}

// RevokeToken revokes a single API token by ID.
func (c *Client) RevokeToken(ctx context.Context, id int64) error {
	return c.do(ctx, http.MethodDelete, "/api/tokens/"+strconv.FormatInt(id, 10), nil, nil, nil)
}

// RevokeAllTokens revokes every active token belonging to the caller —
// including the one authenticating this request.
func (c *Client) RevokeAllTokens(ctx context.Context) error {
	return c.do(ctx, http.MethodPost, "/api/tokens/revoke-all", nil, nil, nil)
}
