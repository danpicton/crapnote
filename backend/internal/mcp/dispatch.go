package mcp

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"

	"github.com/danpicton/crapnote/internal/apispec"
)

// callResult is the MCP tools/call result payload.
type callResult struct {
	Content []content `json:"content"`
	IsError bool      `json:"isError,omitempty"`
}

// content is one MCP content item (text, image, or embedded resource).
type content struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	Data     string    `json:"data,omitempty"`
	MimeType string    `json:"mimeType,omitempty"`
	Resource *resource `json:"resource,omitempty"`
}

type resource struct {
	URI      string `json:"uri"`
	MimeType string `json:"mimeType"`
	Blob     string `json:"blob"`
}

func textResult(text string) *callResult {
	return &callResult{Content: []content{{Type: "text", Text: text}}}
}

func errorResult(format string, args ...any) *callResult {
	r := textResult(fmt.Sprintf(format, args...))
	r.IsError = true
	return r
}

// dispatch executes one tool call by replaying it as a real HTTP request
// through the server's mux, carrying the caller's credentials. The API's own
// middleware therefore decides authorisation (token scope, cookie-only,
// admin) — the MCP layer adds no policy of its own.
func (h *Handler) dispatch(orig *http.Request, op apispec.Operation, args map[string]any) *callResult {
	path := op.Path
	query := map[string]string{}
	body := map[string]any{}

	for _, p := range op.Params {
		val, present := args[p.Name]
		if !present || val == nil {
			if p.Required {
				return errorResult("missing required argument %q", p.Name)
			}
			continue
		}
		switch p.In {
		case apispec.InPath:
			s, err := scalarString(p, val)
			if err != nil {
				return errorResult("argument %q: %v", p.Name, err)
			}
			if s == "" {
				return errorResult("argument %q must not be empty", p.Name)
			}
			// Escape before splicing: a raw value could otherwise smuggle
			// query/fragment/extra segments into the replayed request, and
			// characters like spaces would make request construction panic.
			path = strings.ReplaceAll(path, "{"+p.Name+"}", url.PathEscape(s))
		case apispec.InQuery:
			s, err := scalarString(p, val)
			if err != nil {
				return errorResult("argument %q: %v", p.Name, err)
			}
			query[p.Name] = s
		case apispec.InBody:
			body[p.Name] = val
		}
	}

	var reqBody *bytes.Buffer
	contentType := ""
	switch op.Request {
	case apispec.RequestMultipartImage:
		var err error
		reqBody, contentType, err = multipartImageBody(op, body)
		if err != nil {
			return errorResult("%v", err)
		}
	default:
		// Always send a JSON object: several handlers decode the body
		// unconditionally and treat EOF as a bad request.
		data, err := json.Marshal(body)
		if err != nil {
			return errorResult("encode request body: %v", err)
		}
		reqBody = bytes.NewBuffer(data)
		contentType = "application/json"
	}

	target := path
	if len(query) > 0 {
		q := url.Values{}
		for k, v := range query {
			q.Set(k, v)
		}
		target += "?" + q.Encode()
	}

	// The MCP request's context already carries the authenticated user and
	// auth flags (RequireAuth ran before this handler), so no credentials
	// are copied onto the replayed request: RequireAuth passes context-
	// authenticated requests through, and the scope middleware reads the
	// same context. This keeps the caller's token out of a second
	// verification (and rate-limit charge) and forwards nothing else from
	// the MCP request.
	req := httptest.NewRequestWithContext(orig.Context(), op.Method, target, reqBody)
	if op.Method != http.MethodGet {
		req.Header.Set("Content-Type", contentType)
	}
	// Carry the caller's address across: handlers audit-log the client IP
	// (token revocation among them), and httptest's placeholder 192.0.2.1
	// would attribute every MCP-driven action to the same fictional client.
	req.RemoteAddr = orig.RemoteAddr

	rec := newCaptured(maxDispatchResponse)
	h.api.ServeHTTP(rec, req)
	return wrapResponse(op, rec)
}

// maxDispatchResponse caps how much of an API response one tool call will
// buffer. The result is held several times over (buffer, base64 string, JSON
// encoding), so an uncapped export of a large account could exhaust memory;
// every other body path in the app is bounded too.
const maxDispatchResponse = 32 << 20

// captured is a bounded http.ResponseWriter: it records the status, headers,
// and up to limit bytes of body, discarding (and flagging) anything beyond.
type captured struct {
	header      http.Header
	status      int
	body        bytes.Buffer
	limit       int
	overflow    bool
	wroteHeader bool
}

func newCaptured(limit int) *captured {
	return &captured{header: make(http.Header), status: http.StatusOK, limit: limit}
}

func (c *captured) Header() http.Header { return c.header }

func (c *captured) WriteHeader(status int) {
	if c.wroteHeader {
		return
	}
	c.wroteHeader = true
	c.status = status
}

func (c *captured) Write(p []byte) (int, error) {
	c.wroteHeader = true
	if c.overflow {
		return len(p), nil
	}
	if c.body.Len()+len(p) > c.limit {
		c.overflow = true
		c.body.Reset()
		return len(p), nil
	}
	return c.body.Write(p)
}

func wrapResponse(op apispec.Operation, rec *captured) *callResult {
	status := rec.status
	// Only 2xx is success: a 3xx here means the mux redirected (e.g. path
	// cleaning) instead of running a handler, and returning its body as a
	// tool result would hand the agent garbage that looks valid.
	if status < 200 || status >= 300 {
		msg := strings.TrimSpace(rec.body.String())
		if msg == "" {
			msg = http.StatusText(status)
		}
		return errorResult("API error %d: %s", status, msg)
	}
	if rec.overflow {
		return errorResult("response is larger than %d bytes; fetch it from the HTTP API instead", rec.limit)
	}

	switch op.Response {
	case apispec.ResponseNone:
		return textResult(`{"ok":true}`)
	case apispec.ResponseImage:
		return &callResult{Content: []content{{
			Type:     "image",
			Data:     base64.StdEncoding.EncodeToString(rec.body.Bytes()),
			MimeType: rec.header.Get("Content-Type"),
		}}}
	case apispec.ResponseBinary:
		return &callResult{Content: []content{{
			Type: "resource",
			Resource: &resource{
				URI:      "crapnote://" + op.Name,
				MimeType: rec.header.Get("Content-Type"),
				Blob:     base64.StdEncoding.EncodeToString(rec.body.Bytes()),
			},
		}}}
	default:
		body := strings.TrimSpace(rec.body.String())
		if body == "" {
			body = `{"ok":true}`
		}
		return textResult(body)
	}
}

// maxExactInt is the largest integer a JSON number represents exactly.
const maxExactInt = 1 << 53

// scalarString renders a path/query argument as its wire string, validating
// the declared type. JSON numbers arrive as float64.
func scalarString(p apispec.Param, val any) (string, error) {
	switch p.Type {
	case apispec.TypeInteger:
		switch v := val.(type) {
		case float64:
			if v != math.Trunc(v) {
				return "", fmt.Errorf("expected an integer, got %v", v)
			}
			// Beyond 2^53 a JSON number has already lost precision, and
			// converting an out-of-range float to int64 is undefined in Go
			// (it yields a garbage ID rather than an argument error).
			if v > maxExactInt || v < -maxExactInt {
				return "", fmt.Errorf("integer %v is out of range", v)
			}
			return fmt.Sprintf("%d", int64(v)), nil
		case json.Number:
			return v.String(), nil
		default:
			return "", fmt.Errorf("expected an integer, got %T", val)
		}
	case apispec.TypeBoolean:
		v, ok := val.(bool)
		if !ok {
			return "", fmt.Errorf("expected a boolean, got %T", val)
		}
		return fmt.Sprintf("%t", v), nil
	default:
		v, ok := val.(string)
		if !ok {
			return "", fmt.Errorf("expected a string, got %T", val)
		}
		return v, nil
	}
}

func multipartImageBody(op apispec.Operation, body map[string]any) (*bytes.Buffer, string, error) {
	var field, b64 string
	for _, p := range op.Params {
		if p.In == apispec.InBody && p.Type == apispec.TypeBase64 {
			field = p.Name
			v, ok := body[p.Name].(string)
			if !ok {
				return nil, "", fmt.Errorf("argument %q must be a base64 string", p.Name)
			}
			b64 = v
		}
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, "", fmt.Errorf("argument %q is not valid base64: %v", field, err)
	}
	buf := &bytes.Buffer{}
	mw := multipart.NewWriter(buf)
	fw, err := mw.CreateFormFile(field, "upload")
	if err != nil {
		return nil, "", err
	}
	if _, err := fw.Write(data); err != nil {
		return nil, "", err
	}
	if err := mw.Close(); err != nil {
		return nil, "", err
	}
	return buf, mw.FormDataContentType(), nil
}
