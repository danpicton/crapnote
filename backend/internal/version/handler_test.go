package version

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlerReturnsVersionStatus(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`[{"name":"v2.2.0"}]`))
	}))
	defer upstream.Close()

	handler := NewHandler(NewChecker("v2.1.0", upstream.URL, upstream.Client()))
	request := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	response := httptest.NewRecorder()
	handler.Get(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	var status Status
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if status.Version != "v2.1.0" || !status.UpdateAvailable {
		t.Fatalf("unexpected status: %+v", status)
	}
}
