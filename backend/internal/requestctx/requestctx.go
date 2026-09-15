// Package requestctx carries trusted request-origin metadata through internal handlers.
package requestctx

import "context"

type mcpKey struct{}

// WithMCP marks a context as originating from the authenticated MCP endpoint.
func WithMCP(ctx context.Context) context.Context {
	return context.WithValue(ctx, mcpKey{}, true)
}

// IsMCP reports whether the request was replayed by the MCP endpoint.
func IsMCP(ctx context.Context) bool {
	v, _ := ctx.Value(mcpKey{}).(bool)
	return v
}
