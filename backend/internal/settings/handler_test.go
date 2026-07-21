package settings_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/settings"
)

func newHandler(t *testing.T) *settings.Handler {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return settings.NewHandler(settings.NewService(settings.NewRepo(database)))
}

func TestHandler_GetThemeEmptyByDefault(t *testing.T) {
	h := newHandler(t)
	w := httptest.NewRecorder()
	h.GetTheme(w, httptest.NewRequest(http.MethodGet, "/api/theme", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["theme"] != "" {
		t.Fatalf("expected empty theme, got %q", resp["theme"])
	}
}

func TestHandler_SetThenGetTheme(t *testing.T) {
	h := newHandler(t)

	w := httptest.NewRecorder()
	h.SetTheme(w, httptest.NewRequest(http.MethodPut, "/api/admin/theme",
		strings.NewReader(`{"theme":"rosso"}`)))
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	h.GetTheme(w, httptest.NewRequest(http.MethodGet, "/api/theme", nil))
	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["theme"] != "rosso" {
		t.Fatalf("expected rosso, got %q", resp["theme"])
	}
}

func TestHandler_SetThemeRejectsInvalidID(t *testing.T) {
	h := newHandler(t)
	w := httptest.NewRecorder()
	h.SetTheme(w, httptest.NewRequest(http.MethodPut, "/api/admin/theme",
		strings.NewReader(`{"theme":"NOT VALID"}`)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_SetThemeRejectsMalformedJSON(t *testing.T) {
	h := newHandler(t)
	w := httptest.NewRecorder()
	h.SetTheme(w, httptest.NewRequest(http.MethodPut, "/api/admin/theme",
		strings.NewReader(`{`)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}
