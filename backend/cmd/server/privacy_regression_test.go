package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func privacyREST(t *testing.T, mux *http.ServeMux, token, method, path, body string, status int) []byte {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != status {
		t.Fatalf("%s %s: %d %s", method, path, rec.Code, rec.Body.String())
	}
	return rec.Body.Bytes()
}

func TestMCP_PrivateImageURLSpellingsAndExport(t *testing.T) {
	type referenceCase struct {
		name string
		url  func(string) string
	}
	var cases []referenceCase
	for _, spelling := range []string{
		"/api/images/%s", "/api/./images/%s", "/api/other/../images/%s", "/api//images/%s",
		"%%2Fapi%%2Fimages%%2F%s", "https://notes.example/api/./images/%s", "../api/images/%s",
	} {
		cases = append(cases, referenceCase{spelling, func(id string) string { return fmt.Sprintf(spelling, id) }})
	}
	// WHATWG URL parsing removes ASCII tabs and newlines anywhere in a URL,
	// including after HTML entities have been decoded by the renderer.
	for _, control := range []string{"&#9;", "&#x9;", "&Tab;", "&#10;", "&#13;", "\t", "\r\n"} {
		cases = append(cases, referenceCase{"control-" + control, func(id string) string {
			return "/api/images/" + id[:8] + control + id[8:]
		}})
	}
	cases = append(cases, referenceCase{"control-inside-percent-escape", func(id string) string {
		escaped := fmt.Sprintf("%%%02x", id[8])
		return "/api/images/" + id[:8] + escaped[:2] + "&#9;" + escaped[2:] + id[9:]
	}})
	for _, ref := range cases {
		t.Run(ref.name, func(t *testing.T) {
			mux, cookie := newAuthedMux(t)
			token := createToken(t, mux, cookie, "read_write")
			secret := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00")
			var body bytes.Buffer
			mw := multipart.NewWriter(&body)
			part, err := mw.CreateFormFile("image", "secret.png")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(secret); err != nil {
				t.Fatal(err)
			}
			if err := mw.Close(); err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("POST", "/api/images", &body)
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", mw.FormDataContentType())
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != 201 {
				t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
			}
			var upload struct {
				URL string `json:"url"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &upload); err != nil {
				t.Fatal(err)
			}
			id := strings.TrimPrefix(upload.URL, "/api/images/")
			privateID := privacyID(t, privacyREST(t, mux, token, "POST", "/api/notes", fmt.Sprintf(`{"title":"confidential","body":%q,"private":true}`, "![secret]("+ref.url(id)+")"), 201))
			// The MCP caller knows the URL and tries to launder it through a public carrier.
			_, created := mcpCall(t, mux, token, toolCallBody("notes_create", fmt.Sprintf(`{"title":"carrier","body":%q}`, "![image]("+upload.URL+")")))
			if text, bad := toolText(t, created); bad {
				t.Fatal(text)
			}
			_, fetched := mcpCall(t, mux, token, toolCallBody("images_get", fmt.Sprintf(`{"id":%q}`, id)))
			if fetched["result"].(map[string]any)["isError"] != true {
				t.Error("MCP fetched private image bytes")
			}
			if got := privacyREST(t, mux, token, "GET", upload.URL, "", 200); !bytes.Equal(got, secret) {
				t.Fatal("direct REST lost image access")
			}

			_, exported := mcpCall(t, mux, token, toolCallBody("export", `{}`))
			result := exported["result"].(map[string]any)
			if result["isError"] == true {
				t.Fatalf("export: %v", exported)
			}
			resource := result["content"].([]any)[0].(map[string]any)["resource"].(map[string]any)
			archive, err := base64.StdEncoding.DecodeString(resource["blob"].(string))
			if err != nil {
				t.Fatal(err)
			}
			zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
			if err != nil {
				t.Fatal(err)
			}
			if len(zr.File) == 0 {
				t.Fatal("public carrier missing from export")
			}
			for _, file := range zr.File {
				r, err := file.Open()
				if err != nil {
					t.Fatal(err)
				}
				data, err := io.ReadAll(r)
				r.Close()
				if err != nil {
					t.Fatal(err)
				}
				if bytes.Contains(data, secret) || bytes.Contains(data, []byte("confidential")) {
					t.Errorf("export leaked private data in %s", file.Name)
				}
			}
			// Positive control: direct unmarking restores MCP access; this is
			// not a blanket denial of all images or all bearer requests.
			privacyREST(t, mux, token, "PUT", fmt.Sprintf("/api/notes/%d", privateID), `{"private":false}`, 200)
			_, visible := mcpCall(t, mux, token, toolCallBody("images_get", fmt.Sprintf(`{"id":%q}`, id)))
			image := visible["result"].(map[string]any)["content"].([]any)[0].(map[string]any)
			if image["data"] != base64.StdEncoding.EncodeToString(secret) {
				t.Fatalf("public image no longer available: %v", visible)
			}
		})
	}
}
