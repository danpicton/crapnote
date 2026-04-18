package httpx_test

import (
	"net/http/httptest"
	"testing"

	"github.com/danpicton/crapnote/internal/httpx"
)

func TestParsePage_Defaults(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/notes", nil)
	p := httpx.ParsePage(r)
	if p.Limit != httpx.DefaultPageSize || p.Offset != 0 {
		t.Fatalf("expected defaults, got limit=%d offset=%d", p.Limit, p.Offset)
	}
}

func TestParsePage_ClampsAboveMax(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/notes?limit=999", nil)
	p := httpx.ParsePage(r)
	if p.Limit != httpx.MaxPageSize {
		t.Fatalf("expected limit clamped to %d, got %d", httpx.MaxPageSize, p.Limit)
	}
}

func TestParsePage_IgnoresInvalidValues(t *testing.T) {
	for _, raw := range []string{"abc", "-5", "0"} {
		r := httptest.NewRequest("GET", "/api/notes?limit="+raw, nil)
		p := httpx.ParsePage(r)
		if p.Limit != httpx.DefaultPageSize {
			t.Fatalf("limit=%q: expected default, got %d", raw, p.Limit)
		}
	}
}

func TestParsePage_AcceptsValidOffset(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/notes?offset=42", nil)
	p := httpx.ParsePage(r)
	if p.Offset != 42 {
		t.Fatalf("expected offset 42, got %d", p.Offset)
	}
}
