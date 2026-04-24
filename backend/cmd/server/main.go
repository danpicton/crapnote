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
	"github.com/danpicton/crapnote/internal/ratelimit"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/danpicton/crapnote/internal/tokens"
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

	userRepo := auth.NewUserRepo(database)
	sessRepo := auth.NewSessionRepo(database)
	inviteRepo := auth.NewInviteRepo(database)
	authSvc := auth.NewServiceWithInvites(
		userRepo,
		sessRepo,
		inviteRepo,
		time.Duration(ttlDays)*24*time.Hour,
	)
	authHandler := auth.NewHandler(authSvc)
	adminHandler := auth.NewAdminHandlerWithInvites(userRepo, authSvc)
	setupHandler := auth.NewSetupHandler(authSvc)

	// API tokens — bearer auth for external clients (CLIs, scripts).
	tokensSvc := tokens.NewService(tokens.NewRepo(database), userRepo)
	tokensHandler := tokens.NewHandler(tokensSvc)
	usageRecorder := tokens.NewUsageRecorder(tokensSvc, 256)
	usageRecorder.Start(context.Background())
	authHandler.SetBearerAuthenticator(tokens.NewBearerAuth(tokensSvc, usageRecorder))

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

	// Background job: purge expired sessions, runs once per day.
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if err := sessRepo.DeleteExpired(context.Background()); err != nil {
				logger.Error("purge expired sessions", "error", err)
			} else {
				logger.Info("purged expired sessions")
			}
		}
	}()

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

	imagesCfg := images.DefaultConfig()
	if v, err := strconv.Atoi(os.Getenv("IMAGE_UPLOADS_PER_MINUTE")); err == nil && v > 0 {
		imagesCfg.UploadsPerMinute = v
	}
	if v, err := strconv.Atoi(os.Getenv("IMAGE_QUOTA_MB")); err == nil && v > 0 {
		imagesCfg.QuotaBytes = int64(v) << 20
	}
	imagesHandler := images.NewHandlerWith(database, imagesCfg)

	// Login rate limiter: defence against credential brute-forcing (issue #12).
	// Defaults to 5 attempts/min with burst 5 per client IP. Both knobs are
	// tunable via env vars so that E2E suites — which legitimately submit
	// dozens of logins from a single IP within seconds — can loosen the cap
	// without disabling protection in production.
	loginRate := 5.0 / 60.0
	loginBurst := 5
	if v, err := strconv.Atoi(os.Getenv("LOGIN_RATE_PER_MINUTE")); err == nil && v > 0 {
		loginRate = float64(v) / 60.0
	}
	if v, err := strconv.Atoi(os.Getenv("LOGIN_RATE_BURST")); err == nil && v > 0 {
		loginBurst = v
	}
	loginLimiter := ratelimit.New(loginRate, loginBurst)

	// Bearer-auth rate limiter: caps per-IP throughput on requests that
	// present an Authorization header. Defaults to 600 req/min with burst
	// 300 — generous enough for CLI bursts while blunting credential-
	// stuffing attempts and DoS against the verification path.
	bearerRate := 10.0
	bearerBurst := 300
	if v, err := strconv.Atoi(os.Getenv("BEARER_RATE_PER_MINUTE")); err == nil && v > 0 {
		bearerRate = float64(v) / 60.0
	}
	if v, err := strconv.Atoi(os.Getenv("BEARER_RATE_BURST")); err == nil && v > 0 {
		bearerBurst = v
	}
	bearerLimiter := ratelimit.New(bearerRate, bearerBurst)

	port := envOrDefault("PORT", "8080")
	mux := newMux(authHandler, adminHandler, setupHandler, notesHandler, tagsHandler, trashHandler, exportHandler, imagesHandler, tokensHandler, loginLimiter, bearerLimiter)

	// Wrap with observability middleware (metrics outermost, then logging, then security headers).
	handler := middleware.Metrics()(middleware.Logging(logger)(middleware.SecurityHeaders()(mux)))

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
