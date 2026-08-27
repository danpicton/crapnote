package mcp

import (
	"github.com/danpicton/crapnote/internal/apispec"
)

// tool is the MCP tools/list wire representation.
type tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

// buildTools renders one MCP tool per registry operation.
func buildTools(ops []apispec.Operation) []tool {
	out := make([]tool, 0, len(ops))
	for _, op := range ops {
		out = append(out, tool{
			Name:        op.Name,
			Description: op.Description,
			InputSchema: inputSchema(op),
		})
	}
	return out
}

func inputSchema(op apispec.Operation) map[string]any {
	props := map[string]any{}
	var required []string
	for _, p := range op.Params {
		props[p.Name] = paramSchema(p)
		if p.Required {
			required = append(required, p.Name)
		}
	}
	schema := map[string]any{
		"type":       "object",
		"properties": props,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func paramSchema(p apispec.Param) map[string]any {
	s := map[string]any{}
	switch p.Type {
	case apispec.TypeInteger:
		s["type"] = "integer"
	case apispec.TypeBoolean:
		s["type"] = "boolean"
	case apispec.TypeIntArray:
		s["type"] = "array"
		s["items"] = map[string]any{"type": "integer"}
	case apispec.TypeBase64:
		s["type"] = "string"
		s["contentEncoding"] = "base64"
	default:
		s["type"] = "string"
	}
	if p.Description != "" {
		s["description"] = p.Description
	}
	return s
}
