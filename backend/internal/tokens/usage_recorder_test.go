package tokens_test

import (
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/tokens"
)

func TestUsageRecorder_RecordsLastUsed(t *testing.T) {
	f := newServiceFixture(t)
	created, err := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeRead, 0)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	rec := tokens.NewUsageRecorder(f.svc, 4)
	rec.Start(t.Context())
	t.Cleanup(rec.Stop)

	rec.Record(created.Token.ID)

	// Poll until last_used_at is populated or we time out.
	deadline := time.Now().Add(2 * time.Second)
	for {
		list, err := f.svc.List(t.Context(), f.admin.ID)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if len(list) == 1 && list[0].LastUsedAt != nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("last_used_at was not set within deadline")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestUsageRecorder_DropsWhenFull(t *testing.T) {
	f := newServiceFixture(t)
	created, _ := f.svc.Create(t.Context(), f.admin, "cli", tokens.ScopeRead, 0)

	// Zero buffer => default 256, so make a tiny buffer but never start the
	// consumer. All events after the buffer fills must be dropped without
	// blocking the caller.
	rec := tokens.NewUsageRecorder(f.svc, 2)
	// No Start(), so nothing consumes.

	for i := 0; i < 100; i++ {
		rec.Record(created.Token.ID) // must not hang
	}
}
