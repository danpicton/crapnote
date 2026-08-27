package mcp

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/apispec"
)

// rpc posts one JSON-RPC message to the handler and decodes the response.
func rpc(t *testing.T, h *Handler, body string) (rpcResponse, *httptest.ResponseRecorder) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var resp rpcResponse
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response %q: %v", rec.Body.String(), err)
		}
	}
	return resp, rec
}

func newTestHandler(api http.Handler) *Handler {
	return NewHandler(apispec.MCPOps(), api)
}

func TestInitialize(t *testing.T) {
	h := newTestHandler(nil)
	resp, _ := rpc(t, h, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}`)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}
	result := resp.Result.(map[string]any)
	if result["protocolVersion"] != "2025-06-18" {
		t.Errorf("protocolVersion = %v", result["protocolVersion"])
	}
	if _, ok := result["serverInfo"].(map[string]any); !ok {
		t.Error("missing serverInfo")
	}
}

func TestInitialize_UnknownClientVersionFallsBack(t *testing.T) {
	h := newTestHandler(nil)
	resp, _ := rpc(t, h, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}`)
	result := resp.Result.(map[string]any)
	if result["protocolVersion"] != protocolVersion {
		t.Errorf("protocolVersion = %v, want %v", result["protocolVersion"], protocolVersion)
	}
}

func TestNotificationGets202(t *testing.T) {
	h := newTestHandler(nil)
	_, rec := rpc(t, h, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if rec.Code != http.StatusAccepted {
		t.Errorf("status = %d, want 202", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("notification response body = %q, want empty", rec.Body.String())
	}
}

func TestUnknownMethod(t *testing.T) {
	h := newTestHandler(nil)
	resp, _ := rpc(t, h, `{"jsonrpc":"2.0","id":1,"method":"resources/list"}`)
	if resp.Error == nil || resp.Error.Code != codeMethodNotFound {
		t.Fatalf("error = %+v, want method-not-found", resp.Error)
	}
}

func TestParseError(t *testing.T) {
	h := newTestHandler(nil)
	resp, _ := rpc(t, h, `{not json`)
	if resp.Error == nil || resp.Error.Code != codeParseError {
		t.Fatalf("error = %+v, want parse error", resp.Error)
	}
}

func TestToolsList_MatchesRegistry(t *testing.T) {
	h := newTestHandler(nil)
	resp, _ := rpc(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if resp.Error != nil {
		t.Fatalf("unexpected error: %+v", resp.Error)
	}
	tools := resp.Result.(map[string]any)["tools"].([]any)
	want := apispec.MCPOps()
	if len(tools) != len(want) {
		t.Fatalf("got %d tools, want %d", len(tools), len(want))
	}
	names := map[string]bool{}
	for _, raw := range tools {
		tl := raw.(map[string]any)
		names[tl["name"].(string)] = true
		if tl["description"] == "" {
			t.Errorf("tool %v has no description", tl["name"])
		}
		schema := tl["inputSchema"].(map[string]any)
		if schema["type"] != "object" {
			t.Errorf("tool %v schema type = %v", tl["name"], schema["type"])
		}
	}
	for _, op := range want {
		if !names[op.Name] {
			t.Errorf("registry op %q missing from tools/list", op.Name)
		}
	}
	// Ops the API refuses over bearer auth must never appear as tools.
	for _, banned := range []string{"tokens_create", "auth_change_password", "admin_users_list", "auth_login"} {
		if names[banned] {
			t.Errorf("tool %q must not be exposed via MCP", banned)
		}
	}
}

func TestToolsCall_UnknownTool(t *testing.T) {
	h := newTestHandler(nil)
	resp, _ := rpc(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"nope"}}`)
	if resp.Error == nil || resp.Error.Code != codeInvalidParams {
		t.Fatalf("error = %+v, want invalid params", resp.Error)
	}
}

// captureAPI records the request the MCP dispatcher replays.
type captureAPI struct {
	req    *http.Request
	body   []byte
	status int
	respCT string
	resp   []byte
}

func (c *captureAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.req = r
	c.body, _ = io.ReadAll(r.Body)
	if c.respCT != "" {
		w.Header().Set("Content-Type", c.respCT)
	}
	if c.status != 0 {
		w.WriteHeader(c.status)
	}
	_, _ = w.Write(c.resp)
}

func callTool(t *testing.T, h *Handler, name string, args string, header http.Header) rpcResponse {
	t.Helper()
	body := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%q,"arguments":%s}}`, name, args)
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.RemoteAddr = "203.0.113.5:9999"
	for k, vs := range header {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var resp rpcResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp
}

func resultOf(t *testing.T, resp rpcResponse) callResult {
	t.Helper()
	if resp.Error != nil {
		t.Fatalf("unexpected rpc error: %+v", resp.Error)
	}
	raw, _ := json.Marshal(resp.Result)
	var cr callResult
	if err := json.Unmarshal(raw, &cr); err != nil {
		t.Fatalf("decode call result: %v", err)
	}
	return cr
}

func TestToolsCall_DispatchesThroughAPI(t *testing.T) {
	api := &captureAPI{status: 200, respCT: "application/json", resp: []byte(`[{"id":1}]`)}
	h := newTestHandler(api)

	hdr := http.Header{"Authorization": {"Bearer cnp_test"}}
	resp := callTool(t, h, "notes_list", `{"search":"tea & biscuits","starred":true,"limit":10}`, hdr)
	cr := resultOf(t, resp)

	if api.req.Method != http.MethodGet || api.req.URL.Path != "/api/notes" {
		t.Fatalf("dispatched %s %s", api.req.Method, api.req.URL.Path)
	}
	q := api.req.URL.Query()
	if q.Get("search") != "tea & biscuits" || q.Get("starred") != "true" || q.Get("limit") != "10" {
		t.Errorf("query = %v", api.req.URL.RawQuery)
	}
	// The credential is deliberately not re-sent: the replayed request
	// carries the already-verified identity on its context, and re-sending it
	// would authenticate (and rate-limit) the same call twice.
	if api.req.Header.Get("Authorization") != "" {
		t.Error("authorization header should not be replayed")
	}
	if api.req.RemoteAddr != "203.0.113.5:9999" {
		t.Errorf("RemoteAddr = %q, want the caller's address", api.req.RemoteAddr)
	}
	if cr.IsError || cr.Content[0].Text != `[{"id":1}]` {
		t.Errorf("result = %+v", cr)
	}
}

func TestToolsCall_PathAndBodyParams(t *testing.T) {
	api := &captureAPI{status: 200, respCT: "application/json", resp: []byte(`{}`)}
	h := newTestHandler(api)

	resp := callTool(t, h, "notes_update", `{"id":42,"title":"new"}`, nil)
	resultOf(t, resp)

	if api.req.URL.Path != "/api/notes/42" {
		t.Errorf("path = %s", api.req.URL.Path)
	}
	var body map[string]any
	if err := json.Unmarshal(api.body, &body); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if body["title"] != "new" {
		t.Errorf("body = %v", body)
	}
	if _, present := body["id"]; present {
		t.Error("path param leaked into body")
	}
}

func TestToolsCall_MissingRequiredArg(t *testing.T) {
	h := newTestHandler(&captureAPI{})
	cr := resultOf(t, callTool(t, h, "notes_get", `{}`, nil))
	if !cr.IsError || !strings.Contains(cr.Content[0].Text, `"id"`) {
		t.Errorf("result = %+v, want missing-argument error", cr)
	}
}

func TestToolsCall_APIErrorBecomesToolError(t *testing.T) {
	api := &captureAPI{status: 403, respCT: "application/json", resp: []byte(`{"error":"this api token is read-only"}`)}
	h := newTestHandler(api)
	cr := resultOf(t, callTool(t, h, "notes_create", `{"title":"x"}`, nil))
	if !cr.IsError {
		t.Fatal("expected isError")
	}
	if !strings.Contains(cr.Content[0].Text, "403") || !strings.Contains(cr.Content[0].Text, "read-only") {
		t.Errorf("error text = %q", cr.Content[0].Text)
	}
}

func TestToolsCall_NoneResponse(t *testing.T) {
	api := &captureAPI{status: 204}
	h := newTestHandler(api)
	cr := resultOf(t, callTool(t, h, "notes_delete", `{"id":7}`, nil))
	if cr.IsError || cr.Content[0].Text != `{"ok":true}` {
		t.Errorf("result = %+v", cr)
	}
}

func TestToolsCall_ImageResponse(t *testing.T) {
	png := []byte{0x89, 'P', 'N', 'G'}
	api := &captureAPI{status: 200, respCT: "image/png", resp: png}
	h := newTestHandler(api)
	cr := resultOf(t, callTool(t, h, "images_get", `{"id":"abc"}`, nil))
	c := cr.Content[0]
	if c.Type != "image" || c.MimeType != "image/png" {
		t.Fatalf("content = %+v", c)
	}
	if got, _ := base64.StdEncoding.DecodeString(c.Data); string(got) != string(png) {
		t.Error("image data mismatch")
	}
}

func TestToolsCall_BinaryResponse(t *testing.T) {
	api := &captureAPI{status: 200, respCT: "application/zip", resp: []byte("PKzip")}
	h := newTestHandler(api)
	cr := resultOf(t, callTool(t, h, "export", `{}`, nil))
	c := cr.Content[0]
	if c.Type != "resource" || c.Resource == nil || c.Resource.MimeType != "application/zip" {
		t.Fatalf("content = %+v", c)
	}
	if got, _ := base64.StdEncoding.DecodeString(c.Resource.Blob); string(got) != "PKzip" {
		t.Error("blob mismatch")
	}
}

func TestToolsCall_MultipartImageUpload(t *testing.T) {
	api := &captureAPI{status: 201, respCT: "application/json", resp: []byte(`{"url":"/api/images/x"}`)}
	h := newTestHandler(api)

	img := base64.StdEncoding.EncodeToString([]byte("fake-image-bytes"))
	cr := resultOf(t, callTool(t, h, "images_upload", fmt.Sprintf(`{"image":%q}`, img), nil))
	if cr.IsError {
		t.Fatalf("result = %+v", cr)
	}
	if !strings.HasPrefix(api.req.Header.Get("Content-Type"), "multipart/form-data") {
		t.Fatalf("content type = %q", api.req.Header.Get("Content-Type"))
	}
	if !strings.Contains(string(api.body), "fake-image-bytes") {
		t.Error("multipart body missing image bytes")
	}
	if !strings.Contains(string(api.body), `name="image"`) {
		t.Error("multipart body missing image field")
	}
}

func TestToolsCall_BadArgumentType(t *testing.T) {
	h := newTestHandler(&captureAPI{})
	cr := resultOf(t, callTool(t, h, "notes_get", `{"id":"seven"}`, nil))
	if !cr.IsError {
		t.Errorf("result = %+v, want type error", cr)
	}
	cr = resultOf(t, callTool(t, h, "notes_get", `{"id":7.5}`, nil))
	if !cr.IsError {
		t.Errorf("result = %+v, want integer error", cr)
	}
}

// A string path argument is caller-controlled. Interpolating it raw both
// panics httptest.NewRequestWithContext on an unparseable target and lets the
// argument inject extra path segments or a query string.
func TestToolsCall_HostilePathArgumentIsRejected(t *testing.T) {
	// Escaped, these reach the API as one intact path segment — no panic, no
	// injected query string or extra segments.
	for _, id := range []string{"%zz", "a b", "abc?limit=9999"} {
		api := &captureAPI{status: 200, respCT: "image/png", resp: []byte("x")}
		h := newTestHandler(api)

		cr := resultOf(t, callTool(t, h, "images_get", fmt.Sprintf(`{"id":%q}`, id), nil))
		if cr.IsError {
			t.Errorf("id %q: unexpected error %+v", id, cr)
			continue
		}
		if api.req.URL.Path != "/api/images/"+id || api.req.URL.RawQuery != "" {
			t.Errorf("id %q: dispatched path = %q query = %q", id, api.req.URL.Path, api.req.URL.RawQuery)
		}
	}

	// These cannot be one segment, and must not be dispatched at all: an
	// extra segment misses the route and lands on the SPA catch-all.
	for _, id := range []string{"a/b", "x/../../metrics", ""} {
		api := &captureAPI{status: 200, respCT: "image/png", resp: []byte("x")}
		h := newTestHandler(api)

		cr := resultOf(t, callTool(t, h, "images_get", fmt.Sprintf(`{"id":%q}`, id), nil))
		if !cr.IsError {
			t.Errorf("id %q: expected an argument error", id)
		}
		if api.req != nil {
			t.Errorf("id %q: request should not have been dispatched (%q)", id, api.req.URL.String())
		}
	}
}

// Anything outside 2xx is not this operation's response: a redirect from the
// mux's path cleaning, or the SPA catch-all's 200 for an unmatched route,
// must not be handed back as data or as a successful write.
func TestWrapResponse_NonSuccessStatusIsAnError(t *testing.T) {
	for _, status := range []int{http.StatusMovedPermanently, http.StatusFound, http.StatusBadRequest} {
		api := &captureAPI{status: status, respCT: "text/html", resp: []byte("<html>")}
		h := newTestHandler(api)

		cr := resultOf(t, callTool(t, h, "images_get", `{"id":"abc"}`, nil))
		if !cr.IsError {
			t.Errorf("status %d: wrapped as success: %+v", status, cr)
		}
	}

	// A ResponseNone op must not report {"ok":true} for a call that never ran.
	api := &captureAPI{status: http.StatusMovedPermanently}
	h := newTestHandler(api)
	cr := resultOf(t, callTool(t, h, "notes_delete", `{"id":1}`, nil))
	if !cr.IsError {
		t.Errorf("redirect reported as a successful delete: %+v", cr)
	}
}

// A response past the cap is refused rather than buffered, base64-encoded and
// JSON-escaped — three live copies of an unbounded artefact.
func TestWrapResponse_OversizedResponseIsRefused(t *testing.T) {
	rec := newCaptured(64)
	rec.WriteHeader(http.StatusOK)
	if _, err := rec.Write(make([]byte, 128)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if !rec.overflow || rec.body.Len() != 0 {
		t.Fatalf("overflow = %v, buffered %d bytes", rec.overflow, rec.body.Len())
	}
	cr := wrapResponse(apispec.Operation{Response: apispec.ResponseBinary}, rec)
	if !cr.IsError {
		t.Errorf("oversized response wrapped as success: %+v", cr)
	}
}

func TestToolsCall_OutOfRangeIntegerArgument(t *testing.T) {
	api := &captureAPI{status: 200, respCT: "application/json", resp: []byte(`{}`)}
	h := newTestHandler(api)

	cr := resultOf(t, callTool(t, h, "notes_get", `{"id":1e30}`, nil))
	if !cr.IsError {
		t.Fatalf("expected an argument error, dispatched %v", api.req.URL)
	}
	if api.req != nil {
		t.Errorf("out-of-range id dispatched as %q", api.req.URL.Path)
	}
}

// Hosts gate confirmation on the annotations, so an irreversible tool must not
// look like a read.
func TestTools_CarryAnnotations(t *testing.T) {
	byName := map[string]tool{}
	for _, tl := range buildTools(apispec.MCPOps()) {
		byName[tl.Name] = tl
	}
	for _, tc := range []struct {
		name        string
		readOnly    bool
		destructive bool
	}{
		{"notes_list", true, false},
		{"notes_get", true, false},
		{"notes_create", false, false},
		{"notes_delete", false, true},
		{"trash_empty", false, true},
		{"tokens_revoke_all", false, true},
	} {
		tl, ok := byName[tc.name]
		if !ok {
			t.Fatalf("tool %q missing", tc.name)
		}
		if tl.Annotations.ReadOnlyHint != tc.readOnly || tl.Annotations.DestructiveHint != tc.destructive {
			t.Errorf("%s annotations = %+v, want readOnly=%v destructive=%v",
				tc.name, tl.Annotations, tc.readOnly, tc.destructive)
		}
	}
}

func TestServeHTTP_RequestBodyIsBounded(t *testing.T) {
	h := newTestHandler(nil)
	body := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"images_upload","arguments":{"image":%q}}}`,
		strings.Repeat("A", maxRequestBody+1024))
	resp, _ := rpc(t, h, body)
	if resp.Error == nil || resp.Error.Code != codeParseError {
		t.Fatalf("oversized body accepted: %+v", resp)
	}
}

func TestInitialize_OnlyAdvertisesImplementedRevision(t *testing.T) {
	// The pre-2025-06-18 revisions require JSON-RPC batching, which this
	// server does not implement; echoing one back would leave a client
	// batching into an opaque parse error.
	h := newTestHandler(nil)
	resp, _ := rpc(t, h, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}`)
	result := resp.Result.(map[string]any)
	if result["protocolVersion"] != protocolVersion {
		t.Errorf("protocolVersion = %v, want %v", result["protocolVersion"], protocolVersion)
	}
}
