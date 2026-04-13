package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/middleware"
	"github.com/danpicton/crapnote/internal/notes"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/danpicton/crapnote/internal/trash"
)

func main() {
	logger := newLogger()
	slog.SetDefault(logger)

	cfg := db.Config{
		SQLitePath:  envOrDefault("DATABASE_PATH", "notes.db"),
		PostgresURL: os.Getenv("DATABASE_URL"),
	}

	database, err := db.Open(cfg)
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
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
	exportHandler := export.NewHandler(notesSvc, database)
	tagsHandler := tags.NewHandler(tags.NewService(tags.NewRepo(database)))

	trashRepo := trash.NewRepo(database)
	trashSvc := trash.NewService(trashRepo)
	trashHandler := trash.NewHandler(trashSvc)

	// Seed initial admin if no users exist.
	adminUser := os.Getenv("ADMIN_USERNAME")
	adminPass := os.Getenv("ADMIN_PASSWORD")
	if adminUser != "" && adminPass != "" {
		if err := authSvc.SeedAdmin(context.Background(), adminUser, adminPass); err != nil {
			logger.Error("seed admin", "error", err)
			os.Exit(1)
		}
	}

	// Background job: purge trash entries older than 7 days, runs once per day.
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if err := trashSvc.PurgeExpired(context.Background()); err != nil {
				logger.Error("purge expired trash", "error", err)
			} else {
				logger.Info("purged expired trash entries")
			}
		}
	}()

	imagesHandler := images.NewHandler(database)

	port := envOrDefault("PORT", "8080")
	mux := newMux(authHandler, adminHandler, notesHandler, tagsHandler, trashHandler, exportHandler, imagesHandler)

	// Wrap with observability middleware (metrics outermost, then logging).
	handler := middleware.Metrics()(middleware.Logging(logger)(mux))

	addr := fmt.Sprintf(":%s", port)
	logger.Info("server starting", "addr", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
}

// newLogger creates a slog.Logger.  Set LOG_FORMAT=json for JSON output (e.g.
// in production for Loki ingestion).  Set LOG_LEVEL=debug|info|warn|error to
// control verbosity (default: info).
func newLogger() *slog.Logger {
	level := slog.LevelInfo
	switch os.Getenv("LOG_LEVEL") {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}

	opts := &slog.HandlerOptions{Level: level}
	if os.Getenv("LOG_FORMAT") == "json" {
		return slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, opts))
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
