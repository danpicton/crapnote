package trash

import "context"

// Service implements trash business logic.
type Service struct {
	repo *Repo
}

// NewService creates a new trash Service.
func NewService(repo *Repo) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context, userID int64) ([]*Entry, error) {
	return s.repo.List(ctx, userID)
}

func (s *Service) Restore(ctx context.Context, noteID, userID int64) error {
	return s.repo.Restore(ctx, noteID, userID)
}

func (s *Service) DeleteOne(ctx context.Context, noteID, userID int64) error {
	return s.repo.DeleteOne(ctx, noteID, userID)
}

func (s *Service) Empty(ctx context.Context, userID int64) error {
	return s.repo.Empty(ctx, userID)
}

func (s *Service) PurgeExpired(ctx context.Context) error {
	return s.repo.PurgeExpired(ctx)
}
