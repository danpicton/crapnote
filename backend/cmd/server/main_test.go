package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/settings"
)

func TestEnvOrDefault(t *testing.T) {
	const key = "CRAPNOTE_TEST_VAR_XYZ"
	os.Unsetenv(key)

	if got := envOrDefault(key, "fallback"); got != "fallback" {
		t.Fatalf("expected fallback, got %q", got)
	}

	os.Setenv(key, "custom")
	defer os.Unsetenv(key)
	if got := envOrDefault(key, "fallback"); got != "custom" {
		t.Fatalf("expected custom, got %q", got)
	}
}

func TestNewLogger_Levels(t *testing.T) {
	for _, level := range []string{"", "debug", "warn", "error", "info"} {
		t.Run("level="+level, func(t *testing.T) {
			os.Setenv("LOG_LEVEL", level)
			defer os.Unsetenv("LOG_LEVEL")
			l := newLogger()
			if l == nil {
				t.Fatal("expected non-nil logger")
			}
		})
	}
}

func TestNewLogger_JSONFormat(t *testing.T) {
	os.Setenv("LOG_FORMAT", "json")
	defer os.Unsetenv("LOG_FORMAT")
	l := newLogger()
	if l == nil {
		t.Fatal("expected non-nil logger")
	}
}

func TestUIHandler_SPA_Route(t *testing.T) {
	mux := newTestMux(t)

	// Extensionless path → SPA index.html
	req := httptest.NewRequest(http.MethodGet, "/some/spa/route", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	// Should return 200 (served by embedded index.html placeholder)
	if w.Code != http.StatusOK {
		t.Fatalf("SPA route: expected 200, got %d", w.Code)
	}
}

// The manifest registers /share as a Web Share Target, so the share sheet
// navigates there with the shared fields in the query string. It must reach the
// SPA shell rather than 404.
func TestUIHandler_ShareTarget_Route(t *testing.T) {
	mux := newTestMux(t)

	req := httptest.NewRequest(http.MethodGet, "/share?title=Hi&text=There&url=https://example.com", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("share target route: expected 200, got %d", w.Code)
	}
}

func TestUIHandler_Asset_Route(t *testing.T) {
	mux := newTestMux(t)

	// Path with extension → tries to serve static asset; 404 if not present is fine
	req := httptest.NewRequest(http.MethodGet, "/nonexistent.js", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	// We don't assert the code since assets may or may not exist in the embedded FS;
	// we just verify the handler doesn't panic.
	if w.Code == 0 {
		t.Fatal("expected a non-zero status code")
	}
}

// --- DEFAULT_THEME seeding (issue #68) ---------------------------------------

// fakeThemeSeeder stands in for the settings service so the seeding step can be
// driven into failure modes a real in-memory database will not produce (e.g. an
// unreachable store).
type fakeThemeSeeder struct {
	err    error
	called []string
}

func (f *fakeThemeSeeder) SeedGlobalTheme(_ context.Context, theme string) error {
	f.called = append(f.called, theme)
	return f.err
}

// newBufferLogger returns a logger writing to buf at debug level, so tests can
// assert on what startup logged.
func newBufferLogger(buf *bytes.Buffer) *slog.Logger {
	return slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

func newSettingsService(t *testing.T) *settings.Service {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return settings.NewService(settings.NewRepo(database))
}

// An invalid DEFAULT_THEME is an operator typo in a cosmetic setting: it must
// warn (naming the offending value) and let startup continue, never abort the
// process — an aborting seed crash-loops the instance on every restart.
func TestSeedDefaultTheme_InvalidValueWarnsAndStartupContinues(t *testing.T) {
	svc := newSettingsService(t)
	var buf bytes.Buffer

	seedDefaultTheme(context.Background(), svc, "Console-2001", newBufferLogger(&buf))

	// Reaching this line at all is the assertion that seeding is non-fatal:
	// an os.Exit in the seed path would take the test binary down with it.
	out := buf.String()
	if !strings.Contains(out, "level=WARN") {
		t.Fatalf("expected a warning, got log: %q", out)
	}
	if !strings.Contains(out, "Console-2001") {
		t.Fatalf("expected the offending value in the log, got: %q", out)
	}
	if theme, err := svc.GlobalTheme(context.Background()); err != nil || theme != "" {
		t.Fatalf("expected nothing seeded, got theme=%q err=%v", theme, err)
	}
}

func TestSeedDefaultTheme_ValidValueSeedsOnFirstRun(t *testing.T) {
	svc := newSettingsService(t)
	var buf bytes.Buffer

	seedDefaultTheme(context.Background(), svc, "rosso", newBufferLogger(&buf))

	theme, err := svc.GlobalTheme(context.Background())
	if err != nil {
		t.Fatalf("global theme: %v", err)
	}
	if theme != "rosso" {
		t.Fatalf("expected rosso seeded, got %q", theme)
	}
	if strings.Contains(buf.String(), "level=WARN") || strings.Contains(buf.String(), "level=ERROR") {
		t.Fatalf("expected no warning for a valid value, got log: %q", buf.String())
	}
}

// First run only: once an admin has picked a theme in the UI, a later restart
// with DEFAULT_THEME still set must leave that stored choice alone.
func TestSeedDefaultTheme_StoredAdminChoiceWinsOnLaterRestarts(t *testing.T) {
	svc := newSettingsService(t)
	ctx := context.Background()
	if err := svc.SetGlobalTheme(ctx, "bianco"); err != nil {
		t.Fatalf("admin set theme: %v", err)
	}

	seedDefaultTheme(ctx, svc, "rosso", newBufferLogger(&bytes.Buffer{}))

	theme, err := svc.GlobalTheme(ctx)
	if err != nil {
		t.Fatalf("global theme: %v", err)
	}
	if theme != "bianco" {
		t.Fatalf("expected the stored admin choice preserved, got %q", theme)
	}
}

// A store failure (database unreachable) is infrastructure, not operator
// config: it is logged at error level so it reaches alerting, but it is still
// not allowed to abort startup.
func TestSeedDefaultTheme_StoreFailureIsNonFatal(t *testing.T) {
	seeder := &fakeThemeSeeder{err: errors.New("database is locked")}
	var buf bytes.Buffer

	seedDefaultTheme(context.Background(), seeder, "rosso", newBufferLogger(&buf))

	out := buf.String()
	if !strings.Contains(out, "level=ERROR") {
		t.Fatalf("expected an error-level log, got: %q", out)
	}
	if strings.Contains(out, "level=WARN") {
		t.Fatalf("expected a store failure not to be reported as a config warning, got: %q", out)
	}
	if len(seeder.called) != 1 {
		t.Fatalf("expected one seed attempt, got %d", len(seeder.called))
	}
}

func TestSeedDefaultTheme_UnsetIsNoOp(t *testing.T) {
	seeder := &fakeThemeSeeder{}
	var buf bytes.Buffer

	seedDefaultTheme(context.Background(), seeder, "", newBufferLogger(&buf))

	if len(seeder.called) != 0 {
		t.Fatalf("expected no seed attempt when DEFAULT_THEME is unset, got %v", seeder.called)
	}
	if buf.Len() != 0 {
		t.Fatalf("expected no log output when DEFAULT_THEME is unset, got: %q", buf.String())
	}
}

// An invalid DEFAULT_THEME must be reported on the strength of the value being
// malformed, not on whether seeding would have proceeded. SeedGlobalTheme
// short-circuits to nil once a theme is stored — correctly, that is what makes
// seeding first-run-only — so an instance whose admin has ever picked a theme
// would otherwise never surface the operator's typo.
func TestSeedDefaultTheme_InvalidValueWarnsEvenWhenThemeAlreadyStored(t *testing.T) {
	svc := newSettingsService(t)
	ctx := context.Background()
	if err := svc.SetGlobalTheme(ctx, "bianco"); err != nil {
		t.Fatalf("admin set theme: %v", err)
	}
	var buf bytes.Buffer

	seedDefaultTheme(ctx, svc, "Console-2001", newBufferLogger(&buf))

	out := buf.String()
	if !strings.Contains(out, "level=WARN") {
		t.Fatalf("expected a warning even with a theme stored, got log: %q", out)
	}
	if !strings.Contains(out, "Console-2001") {
		t.Fatalf("expected the offending value in the log, got: %q", out)
	}
	if theme, _ := svc.GlobalTheme(ctx); theme != "bianco" {
		t.Fatalf("expected the stored admin choice preserved, got %q", theme)
	}
}

// The mirror case: a valid DEFAULT_THEME with a theme already stored is the
// ordinary steady state, and must stay silent as well as non-destructive.
func TestSeedDefaultTheme_ValidValueWithThemeStoredIsSilent(t *testing.T) {
	svc := newSettingsService(t)
	ctx := context.Background()
	if err := svc.SetGlobalTheme(ctx, "bianco"); err != nil {
		t.Fatalf("admin set theme: %v", err)
	}
	var buf bytes.Buffer

	seedDefaultTheme(ctx, svc, "rosso", newBufferLogger(&buf))

	if out := buf.String(); strings.Contains(out, "level=WARN") || strings.Contains(out, "level=ERROR") {
		t.Fatalf("expected no warning for a valid value, got log: %q", out)
	}
	if theme, _ := svc.GlobalTheme(ctx); theme != "bianco" {
		t.Fatalf("expected the stored admin choice preserved, got %q", theme)
	}
}

// A value already known to be malformed must not be handed to the seeder at
// all: no pointless write attempt, and exactly one warning rather than one from
// the pre-check plus another from the rejected write.
func TestSeedDefaultTheme_InvalidValueSkipsTheSeedAttempt(t *testing.T) {
	seeder := &fakeThemeSeeder{}
	var buf bytes.Buffer

	seedDefaultTheme(context.Background(), seeder, "Console-2001", newBufferLogger(&buf))

	if len(seeder.called) != 0 {
		t.Fatalf("expected no seed attempt for a malformed value, got %v", seeder.called)
	}
	if n := strings.Count(buf.String(), "level=WARN"); n != 1 {
		t.Fatalf("expected exactly one warning, got %d: %q", n, buf.String())
	}
}
