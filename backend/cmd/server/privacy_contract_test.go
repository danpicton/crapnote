package main

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func privacyID(t *testing.T, body []byte) int64 {
	t.Helper()
	var v struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatal(err)
	}
	if v.ID == 0 {
		t.Fatalf("missing id: %s", body)
	}
	return v.ID
}

func TestPrivacy_RESTValidationAndMCPBoundary(t *testing.T) {
	mux, cookie := newAuthedMux(t)
	token := createToken(t, mux, cookie, "read_write")
	readOnly := createToken(t, mux, cookie, "read")
	id := privacyID(t, privacyREST(t, mux, token, "POST", "/api/notes", `{"title":"personal","body":"unchanged"}`, 201))
	path := fmt.Sprintf("/api/notes/%d", id)
	for _, payload := range []string{`{"private":true}`, `{"private":true}`, `{}`, `{"private":false}`, `{"private":false}`, `{"private":true}`} {
		got := privacyREST(t, mux, token, "PUT", path, payload, 200)
		expected := !strings.Contains(payload, "false")
		var note struct {
			Title, Body string
			Private     bool
		}
		if err := json.Unmarshal(got, &note); err != nil {
			t.Fatal(err)
		}
		if note.Private != expected || note.Title != "personal" || note.Body != "unchanged" {
			t.Fatalf("%s: %s", payload, got)
		}
	}
	for _, invalid := range []string{`null`, `"true"`, `1`, `[]`, `{}`} {
		privacyREST(t, mux, token, "POST", "/api/notes", `{"private":`+invalid+`}`, 400)
		privacyREST(t, mux, token, "PUT", path, `{"title":"changed","private":`+invalid+`}`, 400)
	}
	for _, value := range []string{"true", "false"} {
		privacyREST(t, mux, readOnly, "PUT", path, `{"private":`+value+`}`, 403)
		privacyREST(t, mux, readOnly, "POST", "/api/notes", `{"private":`+value+`}`, 403)
	}
	got := privacyREST(t, mux, readOnly, "GET", path, "", 200)
	if !strings.Contains(string(got), `"private":true`) || !strings.Contains(string(got), `"title":"personal"`) {
		t.Fatalf("invalid writes changed note: %s", got)
	}
	for _, tool := range []string{"notes_get", "notes_update", "notes_delete", "notes_archive", "notes_unarchive", "notes_toggle_star", "notes_toggle_pin", "notes_toggle_lock"} {
		_, resp := mcpCall(t, mux, token, toolCallBody(tool, fmt.Sprintf(`{"id":%d}`, id)))
		text, bad := toolText(t, resp)
		if !bad || strings.Contains(text, "personal") {
			t.Fatalf("%s: %s", tool, text)
		}
	}
	_, resp := mcpCall(t, mux, token, toolCallBody("notes_update", fmt.Sprintf(`{"id":%d,"private":false}`, id)))
	if text, bad := toolText(t, resp); !bad {
		t.Fatalf("MCP cleared privacy: %s", text)
	}
	privacyREST(t, mux, token, "PUT", path, `{"private":false}`, 200)
	_, resp = mcpCall(t, mux, token, toolCallBody("notes_get", fmt.Sprintf(`{"id":%d}`, id)))
	if text, bad := toolText(t, resp); bad || !strings.Contains(text, "personal") {
		t.Fatalf("direct clear did not restore MCP visibility: %s", text)
	}
}

func TestPrivacy_AnotherUsersTokenCannotSetOrClear(t *testing.T) {
	mux, ownerCookie := newAuthedMux(t)
	ownerToken := createToken(t, mux, ownerCookie, "read_write")
	id := privacyID(t, privacyREST(t, mux, ownerToken, "POST", "/api/notes", `{"title":"owner","private":true}`, 201))
	req := httptest.NewRequest("POST", "/api/admin/users", strings.NewReader(`{"username":"other","password":"a-long-test-password"}`))
	req.AddCookie(ownerCookie)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 201 {
		t.Fatalf("create other user: %d %s", rec.Code, rec.Body.String())
	}
	otherID := privacyID(t, rec.Body.Bytes())
	enable := httptest.NewRequest("PATCH", fmt.Sprintf("/api/admin/users/%d/api-tokens", otherID), strings.NewReader(`{"enabled":true}`))
	enable.AddCookie(ownerCookie)
	enabled := httptest.NewRecorder()
	mux.ServeHTTP(enabled, enable)
	if enabled.Code != 200 {
		t.Fatalf("enable other user's tokens: %d %s", enabled.Code, enabled.Body.String())
	}
	login := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"other","password":"a-long-test-password"}`))
	loggedIn := httptest.NewRecorder()
	mux.ServeHTTP(loggedIn, login)
	if loggedIn.Code != 200 {
		t.Fatalf("other login: %d", loggedIn.Code)
	}
	otherToken := ""
	for _, cookie := range loggedIn.Result().Cookies() {
		if cookie.Name == "session" {
			otherToken = createToken(t, mux, cookie, "read_write")
		}
	}
	if otherToken == "" {
		t.Fatal("missing other user's token")
	}
	path := fmt.Sprintf("/api/notes/%d", id)
	for _, private := range []bool{false, true} {
		privacyREST(t, mux, otherToken, "PUT", path, fmt.Sprintf(`{"private":%t}`, private), 404)
	}
	got := privacyREST(t, mux, ownerToken, "GET", path, "", 200)
	if !strings.Contains(string(got), `"private":true`) {
		t.Fatalf("other user changed privacy: %s", got)
	}
}

func TestMCP_PrivateTagsArchiveTrashAndBulk(t *testing.T) {
	mux, cookie := newAuthedMux(t)
	token := createToken(t, mux, cookie, "read_write")
	secret := privacyID(t, privacyREST(t, mux, token, "POST", "/api/notes", `{"title":"confidential","body":"classified","private":true}`, 201))
	public := privacyID(t, privacyREST(t, mux, token, "POST", "/api/notes", `{"title":"visible","body":"visible"}`, 201))
	tag := privacyID(t, privacyREST(t, mux, token, "POST", "/api/tags", `{"name":"confidential-tag"}`, 201))
	shared := privacyID(t, privacyREST(t, mux, token, "POST", "/api/tags", `{"name":"shared"}`, 201))
	for _, pair := range [][2]int64{{secret, tag}, {secret, shared}, {public, shared}} {
		privacyREST(t, mux, token, "POST", fmt.Sprintf("/api/notes/%d/tags", pair[0]), fmt.Sprintf(`{"tag_id":%d}`, pair[1]), 204)
	}
	for _, call := range []struct{ name, args string }{
		{"note_tags_add", fmt.Sprintf(`{"id":%d,"tag_id":%d}`, public, tag)},
		{"note_tags_remove", fmt.Sprintf(`{"id":%d,"tid":%d}`, secret, tag)},
		{"tags_rename", fmt.Sprintf(`{"id":%d,"name":"leaked"}`, tag)},
		{"tags_delete", fmt.Sprintf(`{"id":%d}`, shared)},
	} {
		_, resp := mcpCall(t, mux, token, toolCallBody(call.name, call.args))
		if text, bad := toolText(t, resp); !bad {
			t.Fatalf("%s mutated private associations: %s", call.name, text)
		}
	}
	for _, call := range []struct{ name, args string }{
		{"tags_list", `{}`}, {"note_tags_list", fmt.Sprintf(`{"id":%d}`, public)},
		{"note_tags_list", fmt.Sprintf(`{"id":%d}`, secret)},
		{"notes_list", `{}`}, {"notes_list", `{"search":"classified"}`},
	} {
		_, resp := mcpCall(t, mux, token, toolCallBody(call.name, call.args))
		text, bad := toolText(t, resp)
		if bad || strings.Contains(text, "confidential") || strings.Contains(text, "classified") {
			t.Fatalf("%s leaked: %s", call.name, text)
		}
		if call.name == "tags_list" && !strings.Contains(text, `"note_count":1`) {
			t.Fatalf("private association counted: %s", text)
		}
	}
	for _, id := range []int64{secret, public} {
		privacyREST(t, mux, token, "PATCH", fmt.Sprintf("/api/notes/%d/archive", id), "", 204)
	}
	_, archived := mcpCall(t, mux, token, toolCallBody("archive_list", `{}`))
	if text, bad := toolText(t, archived); bad || strings.Contains(text, "confidential") || !strings.Contains(text, "visible") {
		t.Fatal(text)
	}
	for _, id := range []int64{secret, public} {
		privacyREST(t, mux, token, "DELETE", fmt.Sprintf("/api/notes/%d", id), "", 204)
	}
	_, trashed := mcpCall(t, mux, token, toolCallBody("trash_list", `{}`))
	if text, bad := toolText(t, trashed); bad || strings.Contains(text, "confidential") || !strings.Contains(text, "visible") {
		t.Fatal(text)
	}
	for _, tool := range []string{"trash_restore", "trash_delete"} {
		_, resp := mcpCall(t, mux, token, toolCallBody(tool, fmt.Sprintf(`{"id":%d}`, secret)))
		if text, bad := toolText(t, resp); !bad {
			t.Fatalf("%s: %s", tool, text)
		}
	}
	_, emptied := mcpCall(t, mux, token, toolCallBody("trash_empty", `{}`))
	if text, bad := toolText(t, emptied); bad {
		t.Fatal(text)
	}
	got := privacyREST(t, mux, token, "GET", "/api/trash", "", 200)
	if !strings.Contains(string(got), "confidential") || strings.Contains(string(got), "visible") {
		t.Fatalf("bulk empty: %s", got)
	}
}
