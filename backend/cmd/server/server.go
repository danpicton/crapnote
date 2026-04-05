package main

import (
	"encoding/json"
	"net/http"

	"github.com/danpicton/crapnote/internal/auth"
)

func newMux(authHandler *auth.Handler) *http.ServeMux {
	mux := http.NewServeMux()

	// Public endpoints (no auth required).
	mux.HandleFunc("GET /api/health", handleHealth)
	mux.HandleFunc("POST /api/auth/login", authHandler.Login)

	// Authenticated endpoints.
	protected := func(method, pattern string, h http.HandlerFunc) {
		mux.Handle(method+" "+pattern, authHandler.RequireAuth(h))
	}

	protected("POST", "/api/auth/logout", authHandler.Logout)
	protected("GET", "/api/auth/me", authHandler.Me)

	// Admin-only endpoints.
	admin := func(method, pattern string, h http.HandlerFunc) {
		mux.Handle(method+" "+pattern,
			authHandler.RequireAuth(authHandler.RequireAdmin(h)),
		)
	}
	_ = admin // will be used when admin handlers are added

	return mux
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"}) //nolint:errcheck
}
