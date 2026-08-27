package main

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/danpicton/crapnote/internal/apispec"
	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/mcp"
	"github.com/danpicton/crapnote/internal/middleware"
	"github.com/danpicton/crapnote/internal/notes"
	"github.com/danpicton/crapnote/internal/ratelimit"
	"github.com/danpicton/crapnote/internal/settings"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/danpicton/crapnote/internal/tokens"
	"github.com/danpicton/crapnote/internal/trash"
)

func newMux(
	authHandler *auth.Handler,
	adminHandler *auth.AdminHandler,
	setupHandler *auth.SetupHandler,
	notesHandler *notes.Handler,
	tagsHandler *tags.Handler,
	trashHandler *trash.Handler,
	exportHandler *export.Handler,
	imagesHandler *images.Handler,
	tokensHandler *tokens.Handler,
	settingsHandler *settings.Handler,
	loginLimiter *ratelimit.Limiter,
	bearerLimiter *ratelimit.Limiter,
	observe func(http.Handler) http.Handler,
) *http.ServeMux {
	mux := http.NewServeMux()

	// Observability (public — Prometheus scrapes this).
	mux.Handle("GET /metrics", middleware.MetricsHandler())

	// Every /api route is declared in the apispec registry and bound to its
	// handler here. newMux panics (at startup, and in every test that builds
	// a mux) if the two drift: an op with no binding, or a binding with no
	// op. Middleware wrapping — auth, scope, admin, cookie-only, rate
	// limits — derives from the op's registry metadata, so the registry is
	// authoritative about what each endpoint permits.
	bindings := map[string]http.HandlerFunc{
		"health":    handleHealth,
		"theme_get": settingsHandler.GetTheme,

		"auth_login":           authHandler.Login,
		"auth_logout":          authHandler.Logout,
		"auth_me":              authHandler.Me,
		"auth_change_password": authHandler.ChangePassword,

		"setup_get":      setupHandler.Get,
		"setup_complete": setupHandler.Complete,

		"tokens_list":       tokensHandler.List,
		"tokens_create":     tokensHandler.Create,
		"tokens_revoke":     tokensHandler.Revoke,
		"tokens_revoke_all": tokensHandler.RevokeAll,

		"notes_list":         notesHandler.List,
		"notes_create":       notesHandler.Create,
		"notes_get":          notesHandler.Get,
		"notes_update":       notesHandler.Update,
		"notes_delete":       notesHandler.Delete,
		"notes_toggle_star":  notesHandler.ToggleStar,
		"notes_toggle_pin":   notesHandler.TogglePin,
		"notes_toggle_lock":  notesHandler.ToggleLock,
		"notes_reorder_pins": notesHandler.ReorderPins,
		"notes_archive":      notesHandler.Archive,
		"notes_unarchive":    notesHandler.Unarchive,
		"archive_list":       notesHandler.ListArchived,

		"note_tags_list":   tagsHandler.GetForNote,
		"note_tags_add":    tagsHandler.AddToNote,
		"note_tags_remove": tagsHandler.RemoveFromNote,

		"tags_list":   tagsHandler.List,
		"tags_create": tagsHandler.Create,
		"tags_rename": tagsHandler.Rename,
		"tags_delete": tagsHandler.Delete,

		"export": exportHandler.Export,

		"images_upload": imagesHandler.Upload,
		"images_get":    imagesHandler.Serve,

		"trash_list":    trashHandler.List,
		"trash_restore": trashHandler.Restore,
		"trash_delete":  trashHandler.DeleteOne,
		"trash_empty":   trashHandler.Empty,

		"admin_users_list":             adminHandler.ListUsers,
		"admin_users_create":           adminHandler.CreateUser,
		"admin_users_delete":           adminHandler.DeleteUser,
		"admin_user_api_tokens":        adminHandler.SetAPITokensEnabled,
		"admin_user_set_password":      adminHandler.SetUserPassword,
		"admin_user_lock":              adminHandler.LockUser,
		"admin_user_unlock":            adminHandler.UnlockUser,
		"admin_users_invite":           adminHandler.InviteUser,
		"admin_user_regenerate_invite": adminHandler.RegenerateInvite,
		"admin_theme_set":              settingsHandler.SetTheme,
	}

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
	loginRateLimit := ratelimit.Middleware(loginLimiter, ratelimit.ClientIP)

	bound := map[string]bool{}
	for _, op := range apispec.Registry() {
		h, ok := bindings[op.Name]
		if !ok {
			panic(fmt.Sprintf("apispec op %q has no handler binding in newMux", op.Name))
		}
		bound[op.Name] = true

		var handler http.Handler = h
		if op.Scope == apispec.ScopePublic {
			if op.LoginRateLimited {
				// The setup-token flow shares the login limiter: the token's
				// 256 bits of entropy plus the limiter make brute force
				// infeasible.
				handler = loginRateLimit(handler)
			}
		} else {
			if op.AdminOnly {
				handler = authHandler.RequireAdmin(handler)
			}
			if op.Scope == apispec.ScopeWrite {
				handler = authHandler.RequireWrite(handler)
			}
			if op.CookieOnly {
				handler = cookieOnly(handler)
			}
			handler = bearerRateLimit(authHandler.RequireAuth(handler))
		}
		mux.Handle(op.Method+" "+op.Path, handler)
	}
	for name := range bindings {
		if !bound[name] {
			panic(fmt.Sprintf("handler binding %q has no apispec op", name))
		}
	}

	// Built-in MCP server: Streamable HTTP endpoint whose tools are generated
	// from the same registry and dispatched back through this mux, so every
	// tool call passes the real auth/scope middleware above. Requires bearer
	// auth like any protected endpoint.
	//
	// Tool calls dispatch through observe(mux) rather than the bare mux, so a
	// note created over MCP is counted and logged as POST /api/notes like any
	// other request instead of vanishing behind a single POST /mcp.
	dispatchTarget := http.Handler(mux)
	if observe != nil {
		dispatchTarget = observe(mux)
	}
	mcpHandler := mcp.NewHandler(apispec.MCPOps(), dispatchTarget)
	mux.Handle("POST /mcp", bearerRateLimit(authHandler.RequireAuth(mcpHandler)))
	// Methodless pattern: every verb other than POST answers 405. Registering
	// only GET would let DELETE (the transport's session-termination verb),
	// PUT and the rest fall through to the SPA catch-all below, which serves
	// 200 text/html to an unauthenticated caller.
	mux.Handle("/mcp", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Stateless server: no server-initiated SSE stream to offer.
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}))

	// SPA frontend — catch-all after all /api/* routes.
	mux.Handle("/", uiHandler())

	return mux
}

// cookieOnly rejects bearer-authenticated requests with 403. Applied to
// endpoints that must not be reachable through an API token — creating new
// tokens is the motivating case: a leaked token must not be able to issue
// more tokens and escalate persistence. Changing your own password is the
// other: a leaked read-write token must not be able to hijack the account.
func cookieOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth.IsBearerAuth(r.Context()) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"this endpoint is not available via api tokens"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"}) //nolint:errcheck
}
