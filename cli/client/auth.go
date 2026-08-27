package client

import (
	"context"
	"net/http"
)

// Me is the authenticated user as returned by GET /api/auth/me.
type Me struct {
	ID               int64  `json:"id"`
	Username         string `json:"username"`
	IsAdmin          bool   `json:"is_admin"`
	APITokensEnabled bool   `json:"api_tokens_enabled"`
	CreatedAt        string `json:"created_at"`
}

// Me returns the user the configured token authenticates as.
func (c *Client) Me(ctx context.Context) (*Me, error) {
	var m Me
	if err := c.do(ctx, http.MethodGet, "/api/auth/me", nil, nil, &m); err != nil {
		return nil, err
	}
	return &m, nil
}
