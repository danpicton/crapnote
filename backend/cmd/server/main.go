package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/notes"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/danpicton/crapnote/internal/trash"
)

func main() {
	cfg := db.Config{
		SQLitePath:  envOrDefault("DATABASE_PATH", "notes.db"),
		PostgresURL: os.Getenv("DATABASE_URL"),
	}

	database, err := db.Open(cfg)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()

	ttlDays, _ := strconv.Atoi(envOrDefault("SESSION_TTL_DAYS", "7"))
	if ttlDays <= 0 {
		ttlDays = 7
	}

	authSvc := auth.NewService(
		auth.NewUserRepo(database),
		auth.NewSessionRepo(database),
		time.Duration(ttlDays)*24*time.Hour,
	)
	authHandler := auth.NewHandler(authSvc)
	adminHandler := auth.NewAdminHandler(auth.NewUserRepo(database))

	notesSvc := notes.NewService(notes.NewRepo(database))
	notesHandler := notes.NewHandler(notesSvc)
	exportHandler := export.NewHandler(notesSvc)
	tagsHandler := tags.NewHandler(tags.NewService(tags.NewRepo(database)))

	trashRepo := trash.NewRepo(database)
	trashSvc := trash.NewService(trashRepo)
	trashHandler := trash.NewHandler(trashSvc)

	// Seed initial admin if no users exist.
	adminUser := os.Getenv("ADMIN_USERNAME")
	adminPass := os.Getenv("ADMIN_PASSWORD")
	if adminUser != "" && adminPass != "" {
		if err := authSvc.SeedAdmin(context.Background(), adminUser, adminPass); err != nil {
			log.Fatalf("seed admin: %v", err)
		}
	}

	// Background job: purge trash entries older than 7 days, runs once per day.
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if err := trashSvc.PurgeExpired(context.Background()); err != nil {
				log.Printf("purge expired trash: %v", err)
			}
		}
	}()

	port := envOrDefault("PORT", "8080")
	mux := newMux(authHandler, adminHandler, notesHandler, tagsHandler, trashHandler, exportHandler)

	addr := fmt.Sprintf(":%s", port)
	log.Printf("listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
