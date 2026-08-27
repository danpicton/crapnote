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

	hdr := http.Header{"Authorization": {"Bearer cnp_test"}, "Cookie": {"session=abc"}}
	resp := callTool(t, h, "notes_list", `{"search":"tea & biscuits","starred":true,"limit":10}`, hdr)
	cr := resultOf(t, resp)

	if api.req.Method != http.MethodGet || api.req.URL.Path != "/api/notes" {
		t.Fatalf("dispatched %s %s", api.req.Method, api.req.URL.Path)
	}
	q := api.req.URL.Query()
	if q.Get("search") != "tea & biscuits" || q.Get("starred") != "true" || q.Get("limit") != "10" {
		t.Errorf("query = %v", api.req.URL.RawQuery)
	}
	// Auth rides the request context (RequireAuth ran before the MCP
	// handler); no credentials must be copied onto the replayed request.
	if api.req.Header.Get("Authorization") != "" {
		t.Error("authorization header must not be replayed")
	}
	if len(api.req.Cookies()) != 0 {
		t.Error("cookies must not be forwarded to the replayed request")
	}
	if cr.IsError || cr.Content[0].Text != `[{"id":1}]` {
		t.Errorf("result = %+v", cr)
	}
}

func TestToolsCall_PathParamsAreEscaped(t *testing.T) {
	cases := []struct {
		id          string
		wantEscaped string
	}{
		{"foo bar", "/api/images/foo%20bar"},
		{"../trash", "/api/images/..%2Ftrash"},
		{"x?starred=true", "/api/images/x%3Fstarred=true"},
		{"x#frag", "/api/images/x%23frag"},
		{"%zz", "/api/images/%25zz"},
	}
	for _, tc := range cases {
		api := &captureAPI{status: 200, respCT: "image/png", resp: []byte("png")}
		h := newTestHandler(api)
		resp := callTool(t, h, "images_get", fmt.Sprintf(`{"id":%q}`, tc.id), nil)
		cr := resultOf(t, resp)
		if cr.IsError {
			t.Fatalf("id %q: unexpected tool error: %+v", tc.id, cr)
		}
		if got := api.req.URL.EscapedPath(); got != tc.wantEscaped {
			t.Errorf("id %q dispatched to %q, want %q", tc.id, got, tc.wantEscaped)
		}
		if api.req.URL.RawQuery != "" || api.req.URL.Fragment != "" {
			t.Errorf("id %q leaked into query/fragment: %q", tc.id, api.req.URL.String())
		}
	}
}

func TestToolsCall_EmptyPathParamRejected(t *testing.T) {
	h := newTestHandler(&captureAPI{})
	cr := resultOf(t, callTool(t, h, "images_get", `{"id":""}`, nil))
	if !cr.IsError || !strings.Contains(cr.Content[0].Text, "empty") {
		t.Errorf("result = %+v, want empty-argument error", cr)
	}
}

func TestToolsCall_RedirectIsError(t *testing.T) {
	api := &captureAPI{status: 301, respCT: "text/html", resp: []byte(`<a href="/api/trash">Moved</a>`)}
	h := newTestHandler(api)
	cr := resultOf(t, callTool(t, h, "images_get", `{"id":"abc"}`, nil))
	if !cr.IsError || !strings.Contains(cr.Content[0].Text, "301") {
		t.Errorf("result = %+v, want 301 error", cr)
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

func TestBodySizeLimit(t *testing.T) {
	h := newTestHandler(&captureAPI{})
	resp, _ := rpc(t, h, `{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"`+strings.Repeat("a", maxBodyBytes)+`"}}`)
	if resp.Error == nil || !strings.Contains(resp.Error.Message, "exceeds") {
		t.Fatalf("error = %+v, want body-too-large error", resp.Error)
	}
}

func TestBatchRequests(t *testing.T) {
	h := newTestHandler(nil)
	req := httptest.NewRequest(http.MethodPost, "/mcp",
		strings.NewReader(`[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":2,"method":"nope"}]`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var resps []rpcResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resps); err != nil {
		t.Fatalf("batch response not an array: %q", rec.Body.String())
	}
	if len(resps) != 2 {
		t.Fatalf("got %d responses, want 2 (notification excluded)", len(resps))
	}
	if resps[0].Error != nil {
		t.Errorf("ping in batch failed: %+v", resps[0].Error)
	}
	if resps[1].Error == nil || resps[1].Error.Code != codeMethodNotFound {
		t.Errorf("unknown method in batch = %+v, want method-not-found", resps[1].Error)
	}
}

func TestBatchOfNotificationsGets202(t *testing.T) {
	h := newTestHandler(nil)
	req := httptest.NewRequest(http.MethodPost, "/mcp",
		strings.NewReader(`[{"jsonrpc":"2.0","method":"notifications/initialized"}]`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted || rec.Body.Len() != 0 {
		t.Fatalf("status=%d body=%q, want 202 with empty body", rec.Code, rec.Body.String())
	}
}

func TestEmptyBatchIsInvalid(t *testing.T) {
	h := newTestHandler(nil)
	resp, _ := rpc(t, h, `[]`)
	if resp.Error == nil || resp.Error.Code != codeInvalidRequest {
		t.Fatalf("error = %+v, want invalid request", resp.Error)
	}
}

func TestToolsList_Annotations(t *testing.T) {
	h := newTestHandler(nil)
	resp, _ := rpc(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	byName := map[string]map[string]any{}
	for _, raw := range resp.Result.(map[string]any)["tools"].([]any) {
		tl := raw.(map[string]any)
		ann, ok := tl["annotations"].(map[string]any)
		if !ok {
			t.Fatalf("tool %v has no annotations", tl["name"])
		}
		byName[tl["name"].(string)] = ann
	}
	// Irreversible ops must carry the destructive hint so clients confirm
	// with the user before wiping notes.
	for _, name := range []string{"trash_empty", "trash_delete", "tags_delete"} {
		if byName[name]["destructiveHint"] != true || byName[name]["readOnlyHint"] != false {
			t.Errorf("%s annotations = %v, want destructive, not read-only", name, byName[name])
		}
	}
	if byName["notes_list"]["readOnlyHint"] != true || byName["notes_list"]["destructiveHint"] != false {
		t.Errorf("notes_list annotations = %v, want read-only, not destructive", byName["notes_list"])
	}
	// Trashing a note is recoverable for 7 days — not destructive.
	if byName["notes_delete"]["destructiveHint"] != false {
		t.Errorf("notes_delete annotations = %v, want non-destructive (goes to trash)", byName["notes_delete"])
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

// A response past the cap is refused rather than buffered, base64-encoded and
// JSON-escaped — three live copies of an unbounded artefact (export bundles
// every note and image the account holds).
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

// An out-of-range JSON number must be an argument error: converting it to
// int64 is undefined in Go and dispatches a garbage ID instead.
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

// Handlers audit-log the client IP, so the replay must carry the caller's
// address rather than httptest's placeholder.
func TestToolsCall_CarriesCallerAddress(t *testing.T) {
	api := &captureAPI{status: 200, respCT: "application/json", resp: []byte(`[]`)}
	h := newTestHandler(api)

	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"notes_list","arguments":{}}}`
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.RemoteAddr = "203.0.113.5:9999"
	h.ServeHTTP(httptest.NewRecorder(), req)

	if api.req.RemoteAddr != "203.0.113.5:9999" {
		t.Errorf("RemoteAddr = %q, want the caller's address", api.req.RemoteAddr)
	}
}
