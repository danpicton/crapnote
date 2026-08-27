package mcp

import (
	"github.com/danpicton/crapnote/internal/apispec"
)

// tool is the MCP tools/list wire representation.
type tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema map[string]any  `json:"inputSchema"`
	Annotations toolAnnotations `json:"annotations"`
}

// toolAnnotations are the MCP behaviour hints clients use to decide when to
// ask the user for confirmation. destructiveHint defaults to true in the
// spec, so every hint is emitted explicitly.
type toolAnnotations struct {
	ReadOnlyHint    bool `json:"readOnlyHint"`
	DestructiveHint bool `json:"destructiveHint"`
	IdempotentHint  bool `json:"idempotentHint"`
}

// buildTools renders one MCP tool per registry operation.
func buildTools(ops []apispec.Operation) []tool {
	out := make([]tool, 0, len(ops))
	for _, op := range ops {
		out = append(out, tool{
			Name:        op.Name,
			Description: op.Description,
			InputSchema: inputSchema(op),
			Annotations: annotations(op),
		})
	}
	return out
}

// annotations derives the MCP hints from registry metadata: GETs are
// read-only, irreversible ops (trash purge, tag/token deletion) carry the
// destructive hint, and idempotency follows the HTTP method semantics.
func annotations(op apispec.Operation) toolAnnotations {
	return toolAnnotations{
		ReadOnlyHint:    op.Method == "GET",
		DestructiveHint: op.Destructive,
		IdempotentHint:  op.Method == "GET" || op.Method == "PUT" || op.Method == "DELETE",
	}
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
