package tags

import "context"

// Service implements tag business logic.
type Service struct {
	repo *Repo
}

// NewService creates a new tags Service.
func NewService(repo *Repo) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, userID int64, name string) (*Tag, error) {
	return s.repo.Create(ctx, userID, name)
}

func (s *Service) List(ctx context.Context, userID int64, limit, offset int) ([]*TagWithCount, error) {
	return s.repo.List(ctx, userID, limit, offset)
}

func (s *Service) FindByID(ctx context.Context, id, userID int64) (*Tag, error) {
	return s.repo.FindByID(ctx, id, userID)
}

func (s *Service) Rename(ctx context.Context, id, userID int64, name string) (*Tag, error) {
	return s.repo.Rename(ctx, id, userID, name)
}

func (s *Service) Delete(ctx context.Context, id, userID int64) error {
	return s.repo.Delete(ctx, id, userID)
}

func (s *Service) AddToNote(ctx context.Context, noteID, tagID, userID int64) error {
	return s.repo.AddToNote(ctx, noteID, tagID, userID)
}

func (s *Service) RemoveFromNote(ctx context.Context, noteID, tagID, userID int64) error {
	return s.repo.RemoveFromNote(ctx, noteID, tagID, userID)
}

func (s *Service) ListForNote(ctx context.Context, noteID, userID int64) ([]*Tag, error) {
	return s.repo.ListForNote(ctx, noteID, userID)
}
