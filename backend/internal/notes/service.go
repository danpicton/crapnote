package notes

import (
	"context"
	"fmt"
	"time"
)

// Service implements notes business logic.
type Service struct {
	repo *Repo
}

// NewService creates a new notes Service.
func NewService(repo *Repo) *Service {
	return &Service{repo: repo}
}

// Create creates a new note. If title is empty a default is generated.
func (s *Service) Create(ctx context.Context, userID int64, title, body string) (*Note, error) {
	if title == "" {
		title = defaultTitle(time.Now().UTC())
	}
	return s.repo.Create(ctx, userID, title, body)
}

// defaultTitle returns the auto-generated title used when the caller supplies
// no title: "YYYY-MM-DD HH:MM:SS - Weekday" (e.g. "2026-04-14 14:23:30 - Tuesday").
func defaultTitle(now time.Time) string {
	return fmt.Sprintf("%s - %s", now.Format("2006-01-02 15:04:05"), now.Weekday().String())
}

// Get returns a note for the given user, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id, userID int64) (*Note, error) {
	return s.repo.Get(ctx, id, userID)
}

// List returns all non-trashed notes for a user with optional filters.
func (s *Service) List(ctx context.Context, userID int64, filter ListFilter) ([]*Note, error) {
	return s.repo.List(ctx, userID, filter)
}

// Update performs a partial update. Only non-nil fields are written.
// If title is provided as an empty string it is replaced with a timestamp default.
// Returns ErrLocked if the note is locked.
func (s *Service) Update(ctx context.Context, id, userID int64, title, body *string) (*Note, error) {
	if err := s.ensureUnlocked(ctx, id, userID); err != nil {
		return nil, err
	}
	if title != nil && *title == "" {
		t := defaultTitle(time.Now().UTC())
		title = &t
	}
	return s.repo.Update(ctx, id, userID, title, body)
}

// Delete moves a note to the trash. Returns ErrLocked if the note is locked.
func (s *Service) Delete(ctx context.Context, id, userID int64) error {
	if err := s.ensureUnlocked(ctx, id, userID); err != nil {
		return err
	}
	return s.repo.SoftDelete(ctx, id, userID)
}

// ensureUnlocked returns ErrLocked if the note is locked, ErrNotFound if it
// does not belong to the user.
func (s *Service) ensureUnlocked(ctx context.Context, id, userID int64) error {
	locked, err := s.repo.IsLocked(ctx, id, userID)
	if err != nil {
		return err
	}
	if locked {
		return ErrLocked
	}
	return nil
}

// ToggleStar flips the starred flag and returns the updated note.
func (s *Service) ToggleStar(ctx context.Context, id, userID int64) (*Note, error) {
	note, err := s.repo.Get(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SetStarred(ctx, id, userID, !note.Starred); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, id, userID)
}

// Archive moves a note to the archive.
func (s *Service) Archive(ctx context.Context, id, userID int64) error {
	return s.repo.Archive(ctx, id, userID)
}

// Unarchive restores a note from the archive.
func (s *Service) Unarchive(ctx context.Context, id, userID int64) error {
	return s.repo.Unarchive(ctx, id, userID)
}

// ListArchived returns archived notes for a user, optionally paginated.
// limit <= 0 disables pagination.
func (s *Service) ListArchived(ctx context.Context, userID int64, limit, offset int) ([]*Note, error) {
	return s.repo.ListArchived(ctx, userID, limit, offset)
}

// ToggleLock flips the locked flag and returns the updated note. This is the
// only content-protecting operation that is itself allowed on a locked note —
// otherwise a locked note could never be unlocked.
func (s *Service) ToggleLock(ctx context.Context, id, userID int64) (*Note, error) {
	locked, err := s.repo.IsLocked(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SetLocked(ctx, id, userID, !locked); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, id, userID)
}

// AutoLockStale locks notes whose content has not been updated within the given
// window, returning the number newly locked.
func (s *Service) AutoLockStale(ctx context.Context, olderThan time.Duration) (int64, error) {
	return s.repo.AutoLockStale(ctx, olderThan)
}

// TogglePin flips the pinned flag and returns the updated note.
func (s *Service) TogglePin(ctx context.Context, id, userID int64) (*Note, error) {
	note, err := s.repo.Get(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SetPinned(ctx, id, userID, !note.Pinned); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, id, userID)
}
