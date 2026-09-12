package client_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/danpicton/crapnote/cli/client"
)

func TestMeFetchesAuthenticatedUser(t *testing.T) {
	c, rec := newRecordingServer(t, http.StatusOK, `{
		"id":9,
		"username":"alice",
		"is_admin":true,
		"api_tokens_enabled":true,
		"created_at":"2026-01-01T00:00:00Z"
	}`)

	user, err := c.Me(context.Background())
	if err != nil {
		t.Fatalf("Me: %v", err)
	}
	if rec.Method != http.MethodGet || rec.Path != "/api/auth/me" {
		t.Errorf("request = %s %s, want GET /api/auth/me", rec.Method, rec.Path)
	}
	if user.ID != 9 || user.Username != "alice" || !user.IsAdmin || !user.APITokensEnabled {
		t.Errorf("unexpected user: %+v", user)
	}
}

func TestMeReturnsAPIError(t *testing.T) {
	c, _ := newRecordingServer(t, http.StatusUnauthorized, `{"error":"invalid api token"}`)

	user, err := c.Me(context.Background())
	if user != nil {
		t.Errorf("user = %+v, want nil", user)
	}
	if err == nil {
		t.Fatal("Me returned nil error for a rejected token")
	}
}

func TestAPIErrorFormatting(t *testing.T) {
	tests := []struct {
		name string
		err  *client.APIError
		want string
	}{
		{name: "server message", err: &client.APIError{StatusCode: 403, Message: "read-only token"}, want: "read-only token (HTTP 403)"},
		{name: "status only", err: &client.APIError{StatusCode: 502}, want: "api error: HTTP 502"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.want {
				t.Errorf("Error() = %q, want %q", got, tt.want)
			}
		})
	}
}
