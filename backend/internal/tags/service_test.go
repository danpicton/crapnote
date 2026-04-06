package tags_test

import (
	"context"
	"testing"

	"github.com/danpicton/crapnote/internal/tags"
)

func newTestService(t *testing.T) (*tags.Service, int64) {
	t.Helper()
	database := openTestDB(t)
	userID := seedUser(t, database)
	return tags.NewService(tags.NewRepo(database)), userID
}

func TestService_CreateAndList(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	_, err := svc.Create(ctx, userID, "alpha")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	list, err := svc.List(ctx, userID)
	if err != nil || len(list) != 1 || list[0].Name != "alpha" {
		t.Fatalf("List: %v / %+v", err, list)
	}
}

func TestService_Delete_WrongUser(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	tag, _ := svc.Create(ctx, userID, "mine")
	if err := svc.Delete(ctx, tag.ID, userID+1); err != tags.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestService_Rename(t *testing.T) {
	svc, userID := newTestService(t)
	ctx := context.Background()

	tag, _ := svc.Create(ctx, userID, "before")
	after, err := svc.Rename(ctx, tag.ID, userID, "after")
	if err != nil || after.Name != "after" {
		t.Fatalf("Rename: %v / %+v", err, after)
	}
}
