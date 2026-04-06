package main

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
)

// uiFS holds the built SvelteKit static output.
// Before building the Go binary for production, copy the frontend build output:
//
//	cp -r frontend/build backend/cmd/server/ui/build
//
// A placeholder index.html is committed so the binary always compiles.
//
//go:embed all:ui/build
var uiFS embed.FS

// uiHandler returns an http.Handler that serves the embedded SvelteKit SPA.
// Requests for static assets (anything with a file extension) are served
// directly from the embedded FS. Extensionless paths are SvelteKit client-side
// routes, so they all receive index.html.
func uiHandler() http.Handler {
	sub, err := fs.Sub(uiFS, "ui/build")
	if err != nil {
		panic("ui/build embed missing: " + err.Error())
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if path.Ext(r.URL.Path) != "" {
			// Has a file extension (.js, .css, .png, …) — serve the asset.
			fileServer.ServeHTTP(w, r)
			return
		}
		// No extension — SvelteKit client-side route. Serve index.html so the
		// SPA can boot and handle routing itself.
		r2 := *r
		r2.URL.Path = "/"
		fileServer.ServeHTTP(w, &r2)
	})
}
