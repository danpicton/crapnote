package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/export"
	"github.com/danpicton/crapnote/internal/httpx"
	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/middleware"
	"github.com/danpicton/crapnote/internal/notes"
	"github.com/danpicton/crapnote/internal/ratelimit"
	"github.com/danpicton/crapnote/internal/settings"
	"github.com/danpicton/crapnote/internal/tags"
	"github.com/danpicton/crapnote/internal/tokens"
	"github.com/danpicton/crapnote/internal/trash"
)

func main() {
	logger := newLogger()
	slog.SetDefault(logger)

	cfg := db.Config{
		SQLitePath: envOrDefault("DATABASE_PATH", "notes.db"),
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
	// Automatic-lockout policy: after MAX_FAILED_LOGIN_ATTEMPTS consecutive
	// failures (default 5) a non-admin account is locked for
	// LOCKOUT_COOLDOWN_MINUTES (default 15), then unlocks itself. This keeps
	// brute-force protection without letting three bad requests per username
	// create a standing, admin-only-recoverable outage. Manual admin locks
	// remain indefinite.
	lockoutAttempts := auth.DefaultMaxFailedLoginAttempts
	lockoutCooldown := auth.DefaultLockoutCooldown
	if v, err := strconv.Atoi(os.Getenv("MAX_FAILED_LOGIN_ATTEMPTS")); err == nil && v > 0 {
		lockoutAttempts = v
	}
	if v, err := strconv.Atoi(os.Getenv("LOCKOUT_COOLDOWN_MINUTES")); err == nil && v > 0 {
		lockoutCooldown = time.Duration(v) * time.Minute
	}
	authSvc.SetLockoutPolicy(lockoutAttempts, lockoutCooldown)

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

	// Global-theme setting (admin-set default theme for all clients).
	settingsSvc := settings.NewService(settings.NewRepo(database))
	settingsHandler := settings.NewHandler(settingsSvc)
	// DEFAULT_THEME seeds the global theme on first run only — once an admin
	// picks a theme in the UI, the stored value wins over the env var.
	if v := os.Getenv("DEFAULT_THEME"); v != "" {
		if err := settingsSvc.SeedGlobalTheme(context.Background(), v); err != nil {
			logger.Error("seed default theme", "error", err, "theme", v)
			os.Exit(1)
		}
	}

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

	// Background job: lock notes whose content has gone untouched, runs once at
	// startup and then daily. AUTO_LOCK_DAYS=0 disables it.
	autoLockDays, err := strconv.Atoi(envOrDefault("AUTO_LOCK_DAYS", "7"))
	if err != nil || autoLockDays < 0 {
		autoLockDays = 7
	}
	if autoLockDays > 0 {
		window := time.Duration(autoLockDays) * 24 * time.Hour
		autoLock := func() {
			n, err := notesSvc.AutoLockStale(context.Background(), window)
			if err != nil {
				logger.Error("auto-lock stale notes", "error", err)
				return
			}
			if n > 0 {
				logger.Info("auto-locked stale notes", "count", n, "older_than_days", autoLockDays)
			}
		}
		go func() {
			autoLock()
			ticker := time.NewTicker(24 * time.Hour)
			defer ticker.Stop()
			for range ticker.C {
				autoLock()
			}
		}()
	}

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

	// METRICS_ADDR: opt-in Prometheus endpoint, default off. Unset (the
	// default) means /metrics is not served anywhere — the exposition
	// enumerates every route the instance has exercised, reveals traffic and
	// error patterns, and fingerprints the Go runtime, none of which belongs
	// on an internet-facing port. Set it to an address (e.g. ":9090", or
	// "127.0.0.1:9090" to bind loopback only) to serve /metrics on a separate
	// listener reachable from the private network the scraper lives on. The
	// public listener always answers 404 for /metrics.
	metricsSrv, err := serveMetrics(os.Getenv("METRICS_ADDR"), logger)
	if err != nil {
		// A METRICS_ADDR that cannot be bound is a misconfiguration: fail
		// fast rather than run on with the operator believing metrics are
		// being exported.
		logger.Error("start metrics listener", "error", err, "addr", os.Getenv("METRICS_ADDR"))
		os.Exit(1)
	}
	if metricsSrv != nil {
		logger.Info("metrics listener started", "addr", metricsSrv.Addr)
	}

	port := envOrDefault("PORT", "8080")
	// Observability middleware (metrics outermost, then logging, then security
	// headers). newMux applies the same chain to MCP-dispatched tool calls, so
	// they are recorded under the API route they actually exercise.
	observe := func(h http.Handler) http.Handler {
		return middleware.Metrics()(middleware.Logging(logger)(middleware.SecurityHeaders()(h)))
	}
	mux := newMux(authHandler, adminHandler, setupHandler, notesHandler, tagsHandler, trashHandler, exportHandler, imagesHandler, tokensHandler, settingsHandler, loginLimiter, bearerLimiter, observe)

	handler := observe(mux)

	// TRUST_PROXY: opt-in trust of reverse-proxy headers, default off. When
	// off, the client IP used for the login/bearer rate limiters and audit
	// logs is the connection's RemoteAddr, and X-Forwarded-For / X-Real-IP /
	// X-Forwarded-Proto are ignored — they are client-controlled, and
	// honouring them lets an attacker rotate rate-limit buckets and forge
	// audit-log IPs. Set TRUST_PROXY=1 only when exactly one trusted reverse
	// proxy sits in front of the app; the rightmost X-Forwarded-For entry
	// (appended by that proxy) is then used. See httpx.TrustProxy.
	if v, err := strconv.ParseBool(envOrDefault("TRUST_PROXY", "false")); err == nil && v {
		handler = httpx.TrustProxy()(handler)
		logger.Info("trusting reverse-proxy forwarded headers (TRUST_PROXY)")
	}

	addr := fmt.Sprintf(":%s", port)
	logger.Info("server starting", "addr", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
}

// serveMetrics starts a dedicated listener serving only GET /metrics, so
// Prometheus can scrape the app over a private network without the endpoint
// riding on the public port. An empty addr disables it entirely and returns
// (nil, nil) — the safe default. A non-empty addr that cannot be bound
// returns an error; the returned server carries the resolved address (useful
// when addr requests port 0) and is closed by process exit.
func serveMetrics(addr string, logger *slog.Logger) (*http.Server, error) {
	if addr == "" {
		return nil, nil
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()
	mux.Handle("GET /metrics", middleware.MetricsHandler())
	srv := &http.Server{
		Addr:              ln.Addr().String(),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("metrics server error", "error", err)
		}
	}()

	return srv, nil
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
