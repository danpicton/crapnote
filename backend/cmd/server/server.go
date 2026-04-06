package main

import (
	"encoding/json"
	"net/http"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/notes"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/danpicton/crapnote/internal/trash"
)

func newMux(
	authHandler  *auth.Handler,
	adminHandler *auth.AdminHandler,
	notesHandler *notes.Handler,
	tagsHandler  *tags.Handler,
	trashHandler *trash.Handler,
) *http.ServeMux {
	mux := http.NewServeMux()

	// Public.
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("POST /api/auth/login", authHandler.Login)

	// Helpers to reduce repetition.
	protected := func(method, pattern string, h http.HandlerFunc) {
		mux.Handle(method+" "+pattern, authHandler.RequireAuth(h))
	}
	admin := func(method, pattern string, h http.HandlerFunc) {
		mux.Handle(method+" "+pattern,
			authHandler.RequireAuth(authHandler.RequireAdmin(h)),
		)
	}
	// Admin
	admin("GET", "/api/admin/users", adminHandler.ListUsers)
	admin("POST", "/api/admin/users", adminHandler.CreateUser)
	admin("DELETE", "/api/admin/users/{id}", adminHandler.DeleteUser)

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

	// Note–tag associations
	protected("POST", "/api/notes/{id}/tags", tagsHandler.AddToNote)
	protected("DELETE", "/api/notes/{id}/tags/{tid}", tagsHandler.RemoveFromNote)

	// Tags
	protected("GET", "/api/tags", tagsHandler.List)
	protected("POST", "/api/tags", tagsHandler.Create)
	protected("PUT", "/api/tags/{id}", tagsHandler.Rename)
	protected("DELETE", "/api/tags/{id}", tagsHandler.Delete)

	// Trash
	protected("GET", "/api/trash", trashHandler.List)
	protected("POST", "/api/trash/{id}/restore", trashHandler.Restore)
	protected("DELETE", "/api/trash/{id}", trashHandler.DeleteOne)
	protected("DELETE", "/api/trash", trashHandler.Empty)

	return mux
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"}) //nolint:errcheck
}
