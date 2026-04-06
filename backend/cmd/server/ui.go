package main

import (
	"embed"
	"io/fs"
	"net/http"
)

// uiFS holds the built SvelteKit static output.
// Before building the Go binary for production, copy the frontend build output:
//
//	cp -r frontend/build backend/cmd/server/ui/build
//
// A placeholder index.html is committed so the binary always compiles.
//
//go:embed ui/build
var uiFS embed.FS

// uiHandler returns an http.Handler that serves the embedded SvelteKit SPA.
// Unknown paths (i.e., routes handled client-side) fall back to index.html.
func uiHandler() http.Handler {
	sub, err := fs.Sub(uiFS, "ui/build")
	if err != nil {
		panic("ui/build embed missing: " + err.Error())
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to open the requested path inside the embedded FS.
		f, openErr := sub.Open(r.URL.Path)
		if openErr == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// Path not found — serve index.html for client-side routing.
		r2 := *r
		r2.URL.Path = "/"
		fileServer.ServeHTTP(w, &r2)
	})
}
