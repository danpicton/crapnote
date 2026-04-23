package main

import (
	"encoding/json"
	"net/http"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/middleware"
	"github.com/danpicton/crapnote/internal/notes"
	"github.com/danpicton/crapnote/internal/ratelimit"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/danpicton/crapnote/internal/tokens"
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
	tokensHandler  *tokens.Handler,
	loginLimiter   *ratelimit.Limiter,
	bearerLimiter  *ratelimit.Limiter,
) *http.ServeMux {
	mux := http.NewServeMux()

	// Observability (public — Prometheus scrapes this).
	mux.Handle("GET /metrics", middleware.MetricsHandler())

	// Public.
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.Handle("POST /api/auth/login",
		ratelimit.Middleware(loginLimiter, ratelimit.ClientIP)(http.HandlerFunc(authHandler.Login)),
	)

	// bearerRateLimit applies a per-IP limiter only to requests that present
	// an Authorization header — protects against credential stuffing and
	// blunt DoS against the token-verification path while leaving cookie
	// traffic (which browsers pace naturally) unthrottled.
	bearerRateLimit := func(next http.Handler) http.Handler {
		rlm := ratelimit.Middleware(bearerLimiter, ratelimit.ClientIP)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "" {
				rlm(next).ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	// Helpers to reduce repetition.
	protected := func(method, pattern string, h http.HandlerFunc) {
		mux.Handle(method+" "+pattern,
			bearerRateLimit(authHandler.RequireAuth(h)),
		)
	}
	// Write-scoped: requires cookie auth OR a read_write bearer token.
	protectedWrite := func(method, pattern string, h http.HandlerFunc) {
		mux.Handle(method+" "+pattern,
			bearerRateLimit(authHandler.RequireAuth(authHandler.RequireWrite(h))),
		)
	}
	admin := func(method, pattern string, h http.HandlerFunc) {
		mux.Handle(method+" "+pattern,
			bearerRateLimit(authHandler.RequireAuth(authHandler.RequireAdmin(h))),
		)
	}
	// Admin
	admin("GET", "/api/admin/users", adminHandler.ListUsers)
	admin("POST", "/api/admin/users", adminHandler.CreateUser)
	admin("DELETE", "/api/admin/users/{id}", adminHandler.DeleteUser)
	admin("PATCH", "/api/admin/users/{id}/api-tokens", adminHandler.SetAPITokensEnabled)
	admin("PUT", "/api/admin/users/{id}/password", adminHandler.SetUserPassword)
	admin("POST", "/api/admin/users/{id}/lock", adminHandler.LockUser)
	admin("POST", "/api/admin/users/{id}/unlock", adminHandler.UnlockUser)

	// Auth
	protected("POST", "/api/auth/logout", authHandler.Logout)
	protected("GET", "/api/auth/me", authHandler.Me)

	// API tokens (user-facing). List/Revoke are safe over read scope; Create
	// requires cookie auth — you can't bootstrap new tokens from a token.
	protected("GET", "/api/tokens", tokensHandler.List)
	mux.Handle("POST /api/tokens",
		bearerRateLimit(authHandler.RequireAuth(authHandler.RequireWrite(cookieOnly(tokensHandler.Create)))),
	)
	protectedWrite("DELETE", "/api/tokens/{id}", tokensHandler.Revoke)
	protectedWrite("POST", "/api/tokens/revoke-all", tokensHandler.RevokeAll)

	// Notes
	protected("GET", "/api/notes", notesHandler.List)
	protectedWrite("POST", "/api/notes", notesHandler.Create)
	protected("GET", "/api/notes/{id}", notesHandler.Get)
	protectedWrite("PUT", "/api/notes/{id}", notesHandler.Update)
	protectedWrite("DELETE", "/api/notes/{id}", notesHandler.Delete)
	protectedWrite("PATCH", "/api/notes/{id}/star", notesHandler.ToggleStar)
	protectedWrite("PATCH", "/api/notes/{id}/pin", notesHandler.TogglePin)
	protectedWrite("PATCH", "/api/notes/{id}/archive", notesHandler.Archive)
	protectedWrite("PATCH", "/api/notes/{id}/unarchive", notesHandler.Unarchive)
	protected("GET", "/api/archive", notesHandler.ListArchived)

	// Note–tag associations
	protected("GET", "/api/notes/{id}/tags", tagsHandler.GetForNote)
	protectedWrite("POST", "/api/notes/{id}/tags", tagsHandler.AddToNote)
	protectedWrite("DELETE", "/api/notes/{id}/tags/{tid}", tagsHandler.RemoveFromNote)

	// Tags
	protected("GET", "/api/tags", tagsHandler.List)
	protectedWrite("POST", "/api/tags", tagsHandler.Create)
	protectedWrite("PUT", "/api/tags/{id}", tagsHandler.Rename)
	protectedWrite("DELETE", "/api/tags/{id}", tagsHandler.Delete)

	// Export (reads data; treat as read)
	protected("POST", "/api/export", exportHandler.Export)

	// Images
	protectedWrite("POST", "/api/images", imagesHandler.Upload)
	protected("GET", "/api/images/{id}", imagesHandler.Serve)

	// Trash
	protected("GET", "/api/trash", trashHandler.List)
	protectedWrite("POST", "/api/trash/{id}/restore", trashHandler.Restore)
	protectedWrite("DELETE", "/api/trash/{id}", trashHandler.DeleteOne)
	protectedWrite("DELETE", "/api/trash", trashHandler.Empty)

	// SPA frontend — catch-all after all /api/* routes.
	mux.Handle("/", uiHandler())

	return mux
}

// cookieOnly rejects bearer-authenticated requests with 403. Applied to
// endpoints that must not be reachable through an API token — creating new
// tokens is the motivating case: a leaked token must not be able to issue
// more tokens and escalate persistence.
func cookieOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if auth.IsBearerAuth(r.Context()) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"this endpoint is not available via api tokens"}`))
			return
		}
		next(w, r)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"}) //nolint:errcheck
}
