// Package mcp implements CrapNote's built-in MCP (Model Context Protocol)
// server: a stateless Streamable HTTP endpoint at /mcp whose tools are
// generated from the apispec registry — one tool per bearer-reachable API
// operation. Tool calls are replayed through the real HTTP mux with the
// caller's credentials, so the API's own auth and scope middleware governs
// every call; the MCP surface cannot permit anything the API does not.
//
// The implementation is deliberately minimal (tools only, JSON responses,
// no sessions, no server-initiated SSE streams), which the Streamable HTTP
// transport spec permits, and keeps the server stdlib-only.
package mcp

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/danpicton/crapnote/internal/apispec"
)

// maxBodyBytes caps the /mcp request body before any decoding. The largest
// legitimate call is an images_upload: a 10 MB image (the API's own upload
// cap) is ~13.4 MB in base64, so 16 MB leaves headroom for the JSON
// envelope while preventing the unbounded buffering the REST endpoints
// never allow.
const maxBodyBytes = 16 << 20

// protocolVersion is the newest MCP protocol revision this server knows.
const protocolVersion = "2025-06-18"

// supportedVersions are echoed back when a client asks for one of them.
var supportedVersions = map[string]bool{
	"2025-06-18": true,
	"2025-03-26": true,
	"2024-11-05": true,
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

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	if err != nil {
		msg := "read error"
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			msg = fmt.Sprintf("request body exceeds %d bytes", tooLarge.Limit)
		}
		writeJSON(w, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: codeInvalidRequest, Message: msg}})
		return
	}

	// The 2025-03-26 and 2024-11-05 protocol revisions require accepting
	// JSON-RPC batches (arrays); 2025-06-18 dropped them.
	if bytes.HasPrefix(bytes.TrimLeft(body, " \t\r\n"), []byte("[")) {
		h.serveBatch(w, r, body)
		return
	}

	var req rpcRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: codeParseError, Message: "parse error"}})
		return
	}
	if resp := h.handle(r, req); resp != nil {
		writeJSON(w, *resp)
		return
	}
	// Notifications get no response body.
	w.WriteHeader(http.StatusAccepted)
}

func (h *Handler) serveBatch(w http.ResponseWriter, r *http.Request, body []byte) {
	var reqs []rpcRequest
	if err := json.Unmarshal(body, &reqs); err != nil {
		writeJSON(w, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: codeParseError, Message: "parse error"}})
		return
	}
	if len(reqs) == 0 {
		writeJSON(w, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: codeInvalidRequest, Message: "empty batch"}})
		return
	}
	resps := make([]rpcResponse, 0, len(reqs))
	for _, req := range reqs {
		if resp := h.handle(r, req); resp != nil {
			resps = append(resps, *resp)
		}
	}
	if len(resps) == 0 {
		// All notifications: no response body.
		w.WriteHeader(http.StatusAccepted)
		return
	}
	writeJSON(w, resps)
}

// handle processes one JSON-RPC request; a nil return means it was a
// notification and gets no response.
func (h *Handler) handle(r *http.Request, req rpcRequest) *rpcResponse {
	if req.JSONRPC != "2.0" || req.Method == "" {
		return &rpcResponse{JSONRPC: "2.0", ID: req.ID, Error: &rpcError{Code: codeInvalidRequest, Message: "invalid request"}}
	}
	if len(req.ID) == 0 || string(req.ID) == "null" {
		return nil
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
	return &resp
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

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
