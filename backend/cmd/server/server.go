package main

import (
	"encoding/json"
	"net/http"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/notes"
)

func newMux(authHandler *auth.Handler, notesHandler *notes.Handler) *http.ServeMux {
	mux := http.NewServeMux()

	// Public endpoints (no auth required).
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("POST /api/auth/login", authHandler.Login)

	// Authenticated endpoints.
	protected := func(method, pattern string, h http.HandlerFunc) {
		mux.Handle(method+" "+pattern, authHandler.RequireAuth(h))
	}

	// Auth
	protected("POST", "/api/auth/logout", authHandler.Logout)
	protected("GET", "/api/auth/me", authHandler.Me)

	// Notes
	protected("GET", "/api/notes", notesHandler.List)
	protected("POST", "/api/notes", notesHandler.Create)
	protected("GET", "/api/notes/{id}", notesHandler.Get)
	protected("PUT", "/api/notes/{id}", notesHandler.Update)
	protected("DELETE", "/api/notes/{id}", notesHandler.Delete)
	protected("PATCH", "/api/notes/{id}/star", notesHandler.ToggleStar)
	protected("PATCH", "/api/notes/{id}/pin", notesHandler.TogglePin)

	// Admin-only endpoints (populated when admin handlers are added).
	admin := func(method, pattern string, h http.HandlerFunc) {
		mux.Handle(method+" "+pattern,
			authHandler.RequireAuth(authHandler.RequireAdmin(h)),
		)
	}
	_ = admin

	return mux
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"}) //nolint:errcheck
}
