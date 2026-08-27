// Package mcp implements CrapNote's built-in MCP (Model Context Protocol)
// server: a stateless Streamable HTTP endpoint at /mcp whose tools are
// generated from the apispec registry — one tool per bearer-reachable API
// operation. Tool calls are replayed through the real HTTP mux carrying the
// caller's verified identity, so the API's own auth and scope middleware
// governs every call; the MCP surface cannot permit anything the API does not.
//
// The implementation is deliberately minimal (tools only, JSON responses,
// no sessions, no server-initiated SSE streams), which the Streamable HTTP
// transport spec permits, and keeps the server stdlib-only.
package mcp

import (
	"encoding/json"
	"net/http"

	"github.com/danpicton/crapnote/internal/apispec"
)

// protocolVersion is the newest MCP protocol revision this server knows.
const protocolVersion = "2025-06-18"

// supportedVersions are echoed back when a client asks for one of them.
// Only 2025-06-18 is advertised: the earlier revisions require JSON-RPC
// batching, which this server does not implement, so a client that
// negotiated one of them would get an opaque parse error on its first
// batched request. Clients offering an older revision are answered with
// 2025-06-18 and negotiate down.
var supportedVersions = map[string]bool{
	"2025-06-18": true,
}

// Handler serves the MCP Streamable HTTP endpoint.
type Handler struct {
	ops   map[string]apispec.Operation
	tools []tool
	api   http.Handler // the server mux; tool calls dispatch through it
}

// NewHandler creates an MCP handler exposing one tool per operation,
// dispatching tool calls through api (the server's own mux).
func NewHandler(ops []apispec.Operation, api http.Handler) *Handler {
	byName := make(map[string]apispec.Operation, len(ops))
	for _, op := range ops {
		byName[op.Name] = op
	}
	return &Handler{ops: byName, tools: buildTools(ops), api: api}
}

// ── JSON-RPC plumbing ────────────────────────────────────────────────────────

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

const (
	codeParseError     = -32700
	codeInvalidRequest = -32600
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
)

// maxRequestBody bounds a single JSON-RPC message. Params are retained as
// raw JSON and an image upload is then re-materialised several times over
// (raw message, decoded string, image bytes, multipart body), so without a
// cap here a payload far larger than the API's own 10 MB image limit is
// fully buffered before that limit can reject it.
const maxRequestBody = 20 << 20

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeRPC(w, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: codeParseError, Message: "parse error"}})
		return
	}
	if req.JSONRPC != "2.0" || req.Method == "" {
		writeRPC(w, rpcResponse{JSONRPC: "2.0", ID: req.ID, Error: &rpcError{Code: codeInvalidRequest, Message: "invalid request"}})
		return
	}

	// Notifications get no response body.
	if len(req.ID) == 0 || string(req.ID) == "null" {
		w.WriteHeader(http.StatusAccepted)
		return
	}

	resp := rpcResponse{JSONRPC: "2.0", ID: req.ID}
	switch req.Method {
	case "initialize":
		resp.Result = h.initialize(req.Params)
	case "ping":
		resp.Result = struct{}{}
	case "tools/list":
		resp.Result = map[string]any{"tools": h.tools}
	case "tools/call":
		result, rpcErr := h.toolsCall(r, req.Params)
		if rpcErr != nil {
			resp.Error = rpcErr
		} else {
			resp.Result = result
		}
	default:
		resp.Error = &rpcError{Code: codeMethodNotFound, Message: "method not found: " + req.Method}
	}
	writeRPC(w, resp)
}

func (h *Handler) initialize(params json.RawMessage) map[string]any {
	version := protocolVersion
	var p struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	if err := json.Unmarshal(params, &p); err == nil && supportedVersions[p.ProtocolVersion] {
		version = p.ProtocolVersion
	}
	return map[string]any{
		"protocolVersion": version,
		"capabilities": map[string]any{
			"tools": map[string]any{"listChanged": false},
		},
		"serverInfo": map[string]any{
			"name":    "crapnote",
			"title":   "CrapNote",
			"version": "1.0.0",
		},
	}
}

func (h *Handler) toolsCall(r *http.Request, params json.RawMessage) (*callResult, *rpcError) {
	var p struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if err := json.Unmarshal(params, &p); err != nil || p.Name == "" {
		return nil, &rpcError{Code: codeInvalidParams, Message: "invalid tools/call params"}
	}
	op, ok := h.ops[p.Name]
	if !ok {
		return nil, &rpcError{Code: codeInvalidParams, Message: "unknown tool: " + p.Name}
	}
	if p.Arguments == nil {
		p.Arguments = map[string]any{}
	}
	return h.dispatch(r, op, p.Arguments), nil
}

func writeRPC(w http.ResponseWriter, resp rpcResponse) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
