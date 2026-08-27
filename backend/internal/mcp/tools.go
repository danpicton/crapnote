package mcp

import (
	"net/http"

	"github.com/danpicton/crapnote/internal/apispec"
)

// tool is the MCP tools/list wire representation.
type tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Annotations annotations    `json:"annotations"`
}

// annotations are the MCP behavioural hints a host uses to decide when to
// ask the user before running a tool. Without them an irreversible call
// (trash_empty, notes_delete, tokens_revoke_all) is indistinguishable from
// a read, and a host that auto-approves on readOnlyHint runs it unprompted —
// weaker than the CLI, which gates the same operations behind --yes.
type annotations struct {
	ReadOnlyHint    bool `json:"readOnlyHint"`
	DestructiveHint bool `json:"destructiveHint"`
	IdempotentHint  bool `json:"idempotentHint"`
}

// toolAnnotations derives the hints from the registry: a read-scoped
// operation cannot mutate anything, a DELETE (or an op the registry flags
// Destructive) removes state for good, and PUT/DELETE repeat safely (PATCH
// does not — the note toggles flip a flag).
func toolAnnotations(op apispec.Operation) annotations {
	readOnly := op.Scope == apispec.ScopeRead
	return annotations{
		ReadOnlyHint:    readOnly,
		DestructiveHint: !readOnly && (op.Destructive || op.Method == http.MethodDelete),
		IdempotentHint:  !readOnly && (op.Method == http.MethodPut || op.Method == http.MethodDelete),
	}
}

// buildTools renders one MCP tool per registry operation.
func buildTools(ops []apispec.Operation) []tool {
	out := make([]tool, 0, len(ops))
	for _, op := range ops {
		out = append(out, tool{
			Name:        op.Name,
			Description: op.Description,
			InputSchema: inputSchema(op),
			Annotations: toolAnnotations(op),
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
