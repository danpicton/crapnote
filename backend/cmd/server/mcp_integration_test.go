package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/apispec"
)

// createToken mints an API token via the cookie session (the only way).
func createToken(t *testing.T, mux *http.ServeMux, cookie *http.Cookie, scope string) string {
	t.Helper()
	body := fmt.Sprintf(`{"name":"mcp-test","scope":%q}`, scope)
	req := httptest.NewRequest(http.MethodPost, "/api/tokens", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create token: %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode token response: %v", err)
	}
	return resp.Token
}

// mcpCall posts one JSON-RPC message to /mcp with a bearer token.
func mcpCall(t *testing.T, mux *http.ServeMux, token, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	var resp map[string]any
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode /mcp response %q: %v", w.Body.String(), err)
		}
	}
	return w, resp
}

func toolCallBody(name, args string) string {
	return fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%q,"arguments":%s}}`, name, args)
}

// toolText extracts result.content[0].text and whether isError is set.
func toolText(t *testing.T, resp map[string]any) (string, bool) {
	t.Helper()
	result, ok := resp["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result in %v", resp)
	}
	isErr, _ := result["isError"].(bool)
	contents := result["content"].([]any)
	text, _ := contents[0].(map[string]any)["text"].(string)
	return text, isErr
}

func TestMCP_RequiresAuth(t *testing.T) {
	mux := newTestMux(t)
	w, _ := mcpCall(t, mux, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated /mcp = %d, want 401", w.Code)
	}
}

func TestMCP_GetNotSupported(t *testing.T) {
	mux := newTestMux(t)
	req := httptest.NewRequest(http.MethodGet, "/mcp", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET /mcp = %d, want 405", w.Code)
	}
}

func TestMCP_EndToEnd(t *testing.T) {
	mux, cookie := newAuthedMux(t)
	token := createToken(t, mux, cookie, "read_write")

	// initialize
	w, resp := mcpCall(t, mux, token, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("initialize = %d %s", w.Code, w.Body.String())
	}
	if resp["result"].(map[string]any)["protocolVersion"] != "2025-06-18" {
		t.Fatalf("initialize result = %v", resp)
	}

	// tools/list matches the registry's MCP surface
	_, resp = mcpCall(t, mux, token, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	tools := resp["result"].(map[string]any)["tools"].([]any)
	if len(tools) != len(apispec.MCPOps()) {
		t.Fatalf("tools/list returned %d tools, registry has %d", len(tools), len(apispec.MCPOps()))
	}

	// create a note through MCP
	_, resp = mcpCall(t, mux, token, toolCallBody("notes_create", `{"title":"from mcp","body":"hello **world**"}`))
	text, isErr := toolText(t, resp)
	if isErr {
		t.Fatalf("notes_create failed: %s", text)
	}
	var note struct {
		ID    int64  `json:"id"`
		Title string `json:"title"`
	}
	if err := json.Unmarshal([]byte(text), &note); err != nil || note.Title != "from mcp" {
		t.Fatalf("notes_create result = %q (%v)", text, err)
	}

	// list it back via FTS search
	_, resp = mcpCall(t, mux, token, toolCallBody("notes_list", `{"search":"world"}`))
	text, isErr = toolText(t, resp)
	if isErr || !strings.Contains(text, "from mcp") {
		t.Fatalf("notes_list = %q isErr=%v", text, isErr)
	}

	// whoami
	_, resp = mcpCall(t, mux, token, toolCallBody("auth_me", `{}`))
	text, isErr = toolText(t, resp)
	if isErr || !strings.Contains(text, "admin") {
		t.Fatalf("auth_me = %q isErr=%v", text, isErr)
	}

	// trash it and see it in trash_list
	_, resp = mcpCall(t, mux, token, toolCallBody("notes_delete", fmt.Sprintf(`{"id":%d}`, note.ID)))
	if _, isErr = toolText(t, resp); isErr {
		t.Fatal("notes_delete failed")
	}
	_, resp = mcpCall(t, mux, token, toolCallBody("trash_list", `{}`))
	text, isErr = toolText(t, resp)
	if isErr || !strings.Contains(text, "from mcp") {
		t.Fatalf("trash_list = %q isErr=%v", text, isErr)
	}
}

func TestMCP_ReadOnlyTokenCannotWrite(t *testing.T) {
	mux, cookie := newAuthedMux(t)
	token := createToken(t, mux, cookie, "read")

	// Reads work.
	_, resp := mcpCall(t, mux, token, toolCallBody("notes_list", `{}`))
	if _, isErr := toolText(t, resp); isErr {
		t.Fatal("read-only token should be able to list notes")
	}

	// Writes are refused by the API's own scope middleware.
	_, resp = mcpCall(t, mux, token, toolCallBody("notes_create", `{"title":"nope"}`))
	text, isErr := toolText(t, resp)
	if !isErr || !strings.Contains(text, "read-only") {
		t.Fatalf("notes_create with read token = %q isErr=%v, want read-only refusal", text, isErr)
	}
}

// Only POST is implemented. Every other verb must answer 405 rather than
// falling through to the SPA catch-all, which would serve 200 text/html to an
// unauthenticated caller — including DELETE, the transport's own
// session-termination verb.
func TestMCP_OtherMethodsNotSupported(t *testing.T) {
	mux := newTestMux(t)
	for _, method := range []string{http.MethodGet, http.MethodDelete, http.MethodPut, http.MethodOptions, http.MethodPatch} {
		req := httptest.NewRequest(method, "/mcp", nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s /mcp = %d (%s), want 405", method, w.Code, w.Header().Get("Content-Type"))
		}
	}
}

// A mutation made over MCP must show up in metrics and access logs under the
// API route it actually exercised, not just as one POST /mcp.
func TestMCP_DispatchIsObserved(t *testing.T) {
	var observed []string
	observe := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			observed = append(observed, r.Method+" "+r.URL.Path)
			next.ServeHTTP(w, r)
		})
	}
	mux, cookie := newAuthedMux(t, observe)
	token := createToken(t, mux, cookie, "read_write")

	_, resp := mcpCall(t, mux, token, toolCallBody("notes_create", `{"title":"observed"}`))
	if _, isErr := toolText(t, resp); isErr {
		t.Fatalf("tool call failed: %v", resp)
	}

	want := "POST /api/notes"
	for _, got := range observed {
		if got == want {
			return
		}
	}
	t.Errorf("dispatched call not observed: %v, want %q", observed, want)
}
