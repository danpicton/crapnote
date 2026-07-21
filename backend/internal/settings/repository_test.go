package settings_test

import (
	"context"
	"errors"
	"testing"

	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/settings"
)

func newRepo(t *testing.T) *settings.Repo {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return settings.NewRepo(database)
}

func TestRepo_GetMissingKeyReturnsErrNotFound(t *testing.T) {
	repo := newRepo(t)
	_, err := repo.Get(context.Background(), "nope")
	if !errors.Is(err, settings.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestRepo_SetThenGet(t *testing.T) {
	repo := newRepo(t)
	if err := repo.Set(context.Background(), settings.KeyGlobalTheme, "rosso"); err != nil {
		t.Fatalf("set: %v", err)
	}
	v, err := repo.Get(context.Background(), settings.KeyGlobalTheme)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if v != "rosso" {
		t.Fatalf("expected rosso, got %q", v)
	}
}

func TestRepo_SetOverwritesExistingValue(t *testing.T) {
	repo := newRepo(t)
	ctx := context.Background()
	if err := repo.Set(ctx, settings.KeyGlobalTheme, "rosso"); err != nil {
		t.Fatalf("set: %v", err)
	}
	if err := repo.Set(ctx, settings.KeyGlobalTheme, "bianco"); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	v, err := repo.Get(ctx, settings.KeyGlobalTheme)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if v != "bianco" {
		t.Fatalf("expected bianco, got %q", v)
	}
}
