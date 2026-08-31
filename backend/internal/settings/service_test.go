package settings_test

import (
	"context"
	"errors"
	"testing"

	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/settings"
)

func newService(t *testing.T) *settings.Service {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return settings.NewService(settings.NewRepo(database))
}

func TestService_GlobalThemeEmptyWhenUnset(t *testing.T) {
	svc := newService(t)
	theme, err := svc.GlobalTheme(context.Background())
	if err != nil {
		t.Fatalf("global theme: %v", err)
	}
	if theme != "" {
		t.Fatalf("expected empty theme, got %q", theme)
	}
}

func TestService_SetThenGetGlobalTheme(t *testing.T) {
	svc := newService(t)
	ctx := context.Background()
	if err := svc.SetGlobalTheme(ctx, "console-2001"); err != nil {
		t.Fatalf("set: %v", err)
	}
	theme, err := svc.GlobalTheme(ctx)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if theme != "console-2001" {
		t.Fatalf("expected console-2001, got %q", theme)
	}
}

func TestService_SeedGlobalThemeOnlyAppliesWhenUnset(t *testing.T) {
	svc := newService(t)
	ctx := context.Background()

	if err := svc.SeedGlobalTheme(ctx, "rosso"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	theme, _ := svc.GlobalTheme(ctx)
	if theme != "rosso" {
		t.Fatalf("expected seed to apply, got %q", theme)
	}

	// A second seed must not clobber the stored value.
	if err := svc.SeedGlobalTheme(ctx, "bianco"); err != nil {
		t.Fatalf("re-seed: %v", err)
	}
	theme, _ = svc.GlobalTheme(ctx)
	if theme != "rosso" {
		t.Fatalf("expected rosso preserved after re-seed, got %q", theme)
	}
}

func TestService_SetGlobalThemeRejectsInvalidIDs(t *testing.T) {
	svc := newService(t)
	ctx := context.Background()
	for _, bad := range []string{
		"",
		"-leading-dash",
		"UPPER",
		"has space",
		"emoji-💥",
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // 65 chars
	} {
		if err := svc.SetGlobalTheme(ctx, bad); !errors.Is(err, settings.ErrInvalidTheme) {
			t.Fatalf("expected ErrInvalidTheme for %q, got %v", bad, err)
		}
	}
}

// ValidateThemeID is the shape check SetGlobalTheme applies, exported so that
// callers holding a theme id from outside the service (startup reading
// DEFAULT_THEME) can report a malformed one without having to attempt a write.
func TestValidateThemeID(t *testing.T) {
	for _, good := range []string{"light", "console-2001", "rosso", "a", "a1-b2"} {
		if err := settings.ValidateThemeID(good); err != nil {
			t.Errorf("expected %q valid, got %v", good, err)
		}
	}
	for _, bad := range []string{
		"",
		"-leading-dash",
		"Console-2001",
		"UPPER",
		"has space",
		"emoji-💥",
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // 65 chars
	} {
		if err := settings.ValidateThemeID(bad); !errors.Is(err, settings.ErrInvalidTheme) {
			t.Errorf("expected ErrInvalidTheme for %q, got %v", bad, err)
		}
	}
}
