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
	return s.CreateWithPrivacy(ctx, userID, title, body, false)
}

// CreateWithPrivacy creates a note with the requested privacy state.
func (s *Service) CreateWithPrivacy(ctx context.Context, userID int64, title, body string, private bool) (*Note, error) {
	if title == "" {
		title = defaultTitle(time.Now().UTC())
	}
	return s.repo.CreateWithPrivacy(ctx, userID, title, body, private)
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

// ListForExport returns all non-trashed notes, including archived notes.
func (s *Service) ListForExport(ctx context.Context, userID int64) ([]*Note, error) {
	return s.repo.ListForExport(ctx, userID)
}

// Update performs a partial update. Only non-nil fields are written.
// If title is provided as an empty string it is replaced with a timestamp default.
// Returns ErrLocked if the note is locked — the repo's UPDATE enforces that in
// the write itself, so there is no check-then-write gap to race.
func (s *Service) Update(ctx context.Context, id, userID int64, title, body *string) (*Note, error) {
	return s.UpdateWithPrivacy(ctx, id, userID, title, body, nil)
}

// UpdateWithPrivacy preserves every omitted field, including privacy.
func (s *Service) UpdateWithPrivacy(ctx context.Context, id, userID int64, title, body *string, private *bool) (*Note, error) {
	if title != nil && *title == "" {
		t := defaultTitle(time.Now().UTC())
		title = &t
	}
	return s.repo.UpdateWithPrivacy(ctx, id, userID, title, body, private)
}

// Delete moves a note to the trash. Returns ErrLocked if the note is locked.
func (s *Service) Delete(ctx context.Context, id, userID int64) error {
	return s.repo.SoftDelete(ctx, id, userID)
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

// Archive moves a note to the archive. Returns ErrLocked if the note is locked.
func (s *Service) Archive(ctx context.Context, id, userID int64) error {
	return s.repo.Archive(ctx, id, userID)
}

// Unarchive restores a note from the archive.
func (s *Service) Unarchive(ctx context.Context, id, userID int64) error {
	return s.repo.Unarchive(ctx, id, userID)
}

// ListArchived returns archived notes for a user, optionally searched and paginated.
// limit <= 0 disables pagination.
func (s *Service) ListArchived(ctx context.Context, userID int64, search string, limit, offset int) ([]*Note, error) {
	return s.repo.ListArchived(ctx, userID, search, limit, offset)
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

// ReorderPins records the user's drag order for their pinned notes, given the
// note IDs top-first. IDs that are not the user's, or no longer pinned, are
// ignored.
func (s *Service) ReorderPins(ctx context.Context, userID int64, ids []int64) error {
	return s.repo.ReorderPins(ctx, userID, ids)
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
