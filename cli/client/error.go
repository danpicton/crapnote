package client

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// APIError is a non-2xx response from the server, carrying the HTTP status
// and the server's error message ({"error": "..."} body).
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("api error: HTTP %d", e.StatusCode)
	}
	return fmt.Sprintf("%s (HTTP %d)", e.Message, e.StatusCode)
}

func errorFromResponse(resp *http.Response) error {
	apiErr := &APIError{StatusCode: resp.StatusCode}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err == nil {
		var payload struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(body, &payload) == nil {
			apiErr.Message = payload.Error
		}
	}
	return apiErr
}
