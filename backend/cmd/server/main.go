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
	"github.com/danpicton/crapnote/internal/notes"
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

	userRepo := auth.NewUserRepo(database)
	sessRepo := auth.NewSessionRepo(database)
	authSvc := auth.NewService(userRepo, sessRepo, time.Duration(ttlDays)*24*time.Hour)
	authHandler := auth.NewHandler(authSvc)

	notesRepo := notes.NewRepo(database)
	notesSvc := notes.NewService(notesRepo)
	notesHandler := notes.NewHandler(notesSvc)

	// Seed initial admin if no users exist.
	adminUser := os.Getenv("ADMIN_USERNAME")
	adminPass := os.Getenv("ADMIN_PASSWORD")
	if adminUser != "" && adminPass != "" {
		if err := authSvc.SeedAdmin(context.Background(), adminUser, adminPass); err != nil {
			log.Fatalf("seed admin: %v", err)
		}
	}

	port := envOrDefault("PORT", "8080")
	mux := newMux(authHandler, notesHandler)

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
