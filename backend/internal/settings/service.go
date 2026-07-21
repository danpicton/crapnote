package settings

import (
	"context"
	"errors"
	"regexp"
)

// Theme ids are defined by the frontend; the server only enforces shape so
// that adding a theme never needs a backend change. Unknown ids are harmless —
// the client ignores ids it doesn't recognise and falls back to its default.
var themeIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// Service holds business logic for application-wide settings.
type Service struct {
	repo *Repo
}

// NewService creates a new settings Service.
func NewService(repo *Repo) *Service {
	return &Service{repo: repo}
}

// GlobalTheme returns the admin-chosen default theme id, or "" when unset.
func (s *Service) GlobalTheme(ctx context.Context) (string, error) {
	v, err := s.repo.Get(ctx, KeyGlobalTheme)
	if errors.Is(err, ErrNotFound) {
		return "", nil
	}
	return v, err
}

// SetGlobalTheme stores the default theme id after validating its shape.
func (s *Service) SetGlobalTheme(ctx context.Context, theme string) error {
	if !themeIDPattern.MatchString(theme) {
		return ErrInvalidTheme
	}
	return s.repo.Set(ctx, KeyGlobalTheme, theme)
}

// SeedGlobalTheme sets the global theme only when none is stored yet — used
// to apply the DEFAULT_THEME env var on startup without clobbering a theme an
// admin has since chosen in the UI.
func (s *Service) SeedGlobalTheme(ctx context.Context, theme string) error {
	current, err := s.GlobalTheme(ctx)
	if err != nil {
		return err
	}
	if current != "" {
		return nil
	}
	return s.SetGlobalTheme(ctx, theme)
}
