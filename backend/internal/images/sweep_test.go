package images_test

import (
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/images"
)

// newSweepFixture returns a DB with two users, alice and bob.
func newSweepFixture(t *testing.T) (*sql.DB, *auth.User, *auth.User) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	userRepo := auth.NewUserRepo(database)
	alice, err := userRepo.Create(t.Context(), "alice", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	bob, err := userRepo.Create(t.Context(), "bob", "$2a$12$x", false)
	if err != nil {
		t.Fatalf("create bob: %v", err)
	}
	return database, alice, bob
}

// insertImage stores an image owned by userID, created age ago.
func insertImage(t *testing.T, database *sql.DB, id string, userID int64, age time.Duration) {
	t.Helper()
	_, err := database.ExecContext(t.Context(),
		`INSERT INTO images (id, user_id, mime_type, data, created_at) VALUES (?, ?, 'image/png', ?, ?)`,
		id, userID, []byte("0123456789"), time.Now().Add(-age).UTC(),
	)
	if err != nil {
		t.Fatalf("insert image %s: %v", id, err)
	}
}

func insertNote(t *testing.T, database *sql.DB, userID int64, body string, archived bool) int64 {
	t.Helper()
	res, err := database.ExecContext(t.Context(),
		`INSERT INTO notes (user_id, title, body, archived) VALUES (?, 'n', ?, ?)`,
		userID, body, archived,
	)
	if err != nil {
		t.Fatalf("insert note: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func imageExists(t *testing.T, database *sql.DB, id string) bool {
	t.Helper()
	var n int
	if err := database.QueryRowContext(t.Context(),
		`SELECT COUNT(*) FROM images WHERE id = ?`, id).Scan(&n); err != nil {
		t.Fatalf("count image %s: %v", id, err)
	}
	return n > 0
}

func TestSweepOrphans_DeletesOldUnreferencedImages(t *testing.T) {
	database, alice, _ := newSweepFixture(t)

	insertImage(t, database, "old-orphan", alice.ID, 48*time.Hour)
	insertImage(t, database, "new-orphan", alice.ID, time.Minute)

	n, err := images.SweepOrphans(t.Context(), database, images.OrphanGracePeriod, 100)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected 1 image swept, got %d", n)
	}
	if imageExists(t, database, "old-orphan") {
		t.Error("expected old orphan to be deleted")
	}
	if !imageExists(t, database, "new-orphan") {
		t.Error("expected image inside grace period to survive")
	}
}

func TestSweepOrphans_KeepsImagesReferencedByAnyNote(t *testing.T) {
	database, alice, _ := newSweepFixture(t)

	for _, id := range []string{"active", "archived", "trashed", "orphan"} {
		insertImage(t, database, id, alice.ID, 48*time.Hour)
	}
	insertNote(t, database, alice.ID, `<img src="/api/images/active">`, false)
	insertNote(t, database, alice.ID, `<img src="/api/images/archived">`, true)
	trashedID := insertNote(t, database, alice.ID, `<img src="/api/images/trashed">`, false)
	if _, err := database.ExecContext(t.Context(),
		`INSERT INTO trash (note_id, user_id) VALUES (?, ?)`, trashedID, alice.ID); err != nil {
		t.Fatalf("trash note: %v", err)
	}

	if _, err := images.SweepOrphans(t.Context(), database, images.OrphanGracePeriod, 100); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	for _, id := range []string{"active", "archived", "trashed"} {
		if !imageExists(t, database, id) {
			t.Errorf("expected referenced image %q to survive", id)
		}
	}
	if imageExists(t, database, "orphan") {
		t.Error("expected unreferenced image to be deleted")
	}
}

func TestSweepOrphans_ScopedPerOwningUser(t *testing.T) {
	database, alice, bob := newSweepFixture(t)

	insertImage(t, database, "alice-img", alice.ID, 48*time.Hour)
	insertImage(t, database, "bob-img", bob.ID, 48*time.Hour)
	// Alice's note references Bob's image — that must not save Bob's image,
	// since a user can only ever serve their own uploads.
	insertNote(t, database, alice.ID, `<img src="/api/images/bob-img">`, false)
	insertNote(t, database, bob.ID, `<img src="/api/images/bob-img">`, false)

	if _, err := images.SweepOrphans(t.Context(), database, images.OrphanGracePeriod, 100); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	if imageExists(t, database, "alice-img") {
		t.Error("expected alice's orphan to be deleted")
	}
	if !imageExists(t, database, "bob-img") {
		t.Error("expected bob's referenced image to survive")
	}
}

func TestSweepOrphans_BoundsWorkPerPass(t *testing.T) {
	database, alice, _ := newSweepFixture(t)

	for _, id := range []string{"a", "b", "c"} {
		insertImage(t, database, id, alice.ID, 48*time.Hour)
	}

	n, err := images.SweepOrphans(t.Context(), database, images.OrphanGracePeriod, 2)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2 images swept in a bounded pass, got %d", n)
	}
}

// A user sitting at 507 can upload again once their orphans are swept.
func TestSweepOrphans_FreesQuota(t *testing.T) {
	database, alice, _ := newSweepFixture(t)
	h := images.NewHandlerWith(database, images.Config{UploadsPerMinute: 100, QuotaBytes: 100})

	// 10 old orphan images of 10 bytes each fill the 100-byte quota.
	for i := range 10 {
		insertImage(t, database, fmt.Sprintf("orphan-%d", i), alice.ID, 48*time.Hour)
	}

	req := withUser(multipartUpload(t, minimalPNG(), ""), alice)
	w := httptest.NewRecorder()
	h.Upload(w, req)
	if w.Code != http.StatusInsufficientStorage {
		t.Fatalf("expected 507 before sweep, got %d: %s", w.Code, w.Body.String())
	}

	if _, err := images.SweepOrphans(t.Context(), database, images.OrphanGracePeriod, 100); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	req = withUser(multipartUpload(t, minimalPNG(), ""), alice)
	w = httptest.NewRecorder()
	h.Upload(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 after sweep, got %d: %s", w.Code, w.Body.String())
	}
}

// A steady-state pass — every image referenced, nothing to delete — must not
// degenerate into a full notes scan per image. SQLite is capped at a single
// connection, so a slow pass stalls every other request for its duration.
// The threshold is deliberately loose (the quadratic version took ~5s here);
// it only needs to catch a return to per-image scanning.
func TestSweepOrphans_ScalesWithLargeTables(t *testing.T) {
	if testing.Short() {
		t.Skip("scaling guard; skipped under -short")
	}
	database, alice, _ := newSweepFixture(t)

	body := strings.Repeat("filler text ", 700) // ~8KB note bodies
	for i := range 3000 {
		id := fmt.Sprintf("%08x-0000-4000-8000-000000000000", i)
		insertImage(t, database, id, alice.ID, 48*time.Hour)
		insertNote(t, database, alice.ID, body+`<img src="/api/images/`+id+`">`, false)
	}

	start := time.Now()
	n, err := images.SweepOrphans(t.Context(), database, images.OrphanGracePeriod, 500)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected no deletions, got %d", n)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("steady-state sweep took %s over 3000 images/notes; expected well under 2s", elapsed)
	}
}

// Bounding a pass must bound deletions, not candidates: a batch of older
// referenced images must not starve a newer orphan out of every future pass.
func TestSweepOrphans_ReferencedImagesDoNotStarveTheSweep(t *testing.T) {
	database, alice, _ := newSweepFixture(t)

	for i := range 5 {
		id := fmt.Sprintf("kept-%d", i)
		insertImage(t, database, id, alice.ID, 72*time.Hour)
		insertNote(t, database, alice.ID, `<img src="/api/images/`+id+`">`, false)
	}
	insertImage(t, database, "younger-orphan", alice.ID, 48*time.Hour)

	n, err := images.SweepOrphans(t.Context(), database, images.OrphanGracePeriod, 2)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected the orphan to be swept, got %d deletions", n)
	}
	if imageExists(t, database, "younger-orphan") {
		t.Error("expected younger orphan to be deleted despite older referenced images")
	}
}
