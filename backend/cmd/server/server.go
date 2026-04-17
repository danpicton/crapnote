package main

import (
	"encoding/json"
	"net/http"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/middleware"
	"github.com/danpicton/crapnote/internal/notes"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/danpicton/crapnote/internal/trash"
)

func newMux(
	authHandler    *auth.Handler,
	adminHandler   *auth.AdminHandler,
	notesHandler   *notes.Handler,
	tagsHandler    *tags.Handler,
	trashHandler   *trash.Handler,
	exportHandler  *export.Handler,
	imagesHandler  *images.Handler,
) *http.ServeMux {
	mux := http.NewServeMux()

	// Observability (public — Prometheus scrapes this).
	mux.Handle("GET /metrics", middleware.MetricsHandler())

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
	protected("PATCH", "/api/notes/{id}/archive", notesHandler.Archive)
	protected("PATCH", "/api/notes/{id}/unarchive", notesHandler.Unarchive)
	protected("GET", "/api/archive", notesHandler.ListArchived)

	// Note–tag associations
	protected("GET", "/api/notes/{id}/tags", tagsHandler.GetForNote)
	protected("POST", "/api/notes/{id}/tags", tagsHandler.AddToNote)
	protected("DELETE", "/api/notes/{id}/tags/{tid}", tagsHandler.RemoveFromNote)

	// Tags
	protected("GET", "/api/tags", tagsHandler.List)
	protected("POST", "/api/tags", tagsHandler.Create)
	protected("PUT", "/api/tags/{id}", tagsHandler.Rename)
	protected("DELETE", "/api/tags/{id}", tagsHandler.Delete)

	// Export
	protected("POST", "/api/export", exportHandler.Export)

	// Images
	protected("POST", "/api/images", imagesHandler.Upload)
	protected("GET", "/api/images/{id}", imagesHandler.Serve)

	// Trash
	protected("GET", "/api/trash", trashHandler.List)
	protected("POST", "/api/trash/{id}/restore", trashHandler.Restore)
	protected("DELETE", "/api/trash/{id}", trashHandler.DeleteOne)
	protected("DELETE", "/api/trash", trashHandler.Empty)

	// SPA frontend — catch-all after all /api/* routes.
	mux.Handle("/", uiHandler())

	return mux
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"}) //nolint:errcheck
}
