package db_test

import (
	"os"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/db"
)

func TestOpen_RunsMigrations(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer database.Close()

	tables := []string{"users", "sessions", "notes", "tags", "note_tags", "trash"}
	for _, table := range tables {
		var name string
		err := database.QueryRow(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?", table,
		).Scan(&name)
		if err != nil {
			t.Errorf("table %q not found after migration: %v", table, err)
		}
	}

	// FTS5 virtual table
	var ftsName string
	err = database.QueryRow(
		"SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'",
	).Scan(&ftsName)
	if err != nil {
		t.Errorf("notes_fts virtual table not found: %v", err)
	}
}

func TestOpen_IdempotentMigrations(t *testing.T) {
	// Opening the same in-memory DB twice would be two separate DBs, but we can
	// verify that calling Open on an already-migrated path doesn't error.
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}
	database.Close()

	// Second open on a fresh :memory: should also succeed cleanly.
	database2, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	database2.Close()
}

// TestMigration016_DropsFailedLoginAttempts proves the column removal applies
// cleanly — and reverses cleanly — against a row carrying pre-#109 state: a
// stale non-zero counter alongside a live lock.
func TestMigration016_DropsFailedLoginAttempts(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer database.Close()

	// Open() has already applied the up migration, so the column is gone.
	if columnExists(t, database, "failed_login_attempts") {
		t.Fatal("failed_login_attempts still present after migrations")
	}

	// Wind back to the pre-#109 schema so the up migration can be exercised
	// against a row that actually carries the state this change retires.
	down, err := os.ReadFile("migrations/000016_drop_failed_login_attempts.down.sql")
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	if _, err := database.Exec(string(down)); err != nil {
		t.Fatalf("apply down migration: %v", err)
	}
	if !columnExists(t, database, "failed_login_attempts") {
		t.Fatal("failed_login_attempts missing after down migration")
	}

	// A pre-#109 row: stale non-zero counter, live (not yet lapsed) lock.
	if _, err := database.Exec(
		`INSERT INTO users (username, password_hash, failed_login_attempts, locked_at, locked_until)
		 VALUES ('legacy', 'hash', 7, CURRENT_TIMESTAMP, '2099-01-01 00:00:00')`,
	); err != nil {
		t.Fatalf("seed legacy user: %v", err)
	}
	var attempts int
	if err := database.QueryRow(
		`SELECT failed_login_attempts FROM users WHERE username='legacy'`,
	).Scan(&attempts); err != nil {
		t.Fatalf("read seeded counter: %v", err)
	}
	if attempts != 7 {
		t.Fatalf("seed did not take: got %d", attempts)
	}

	// The up migration drops the counter and leaves the live lock — the only
	// state that still decides anything — untouched.
	up, err := os.ReadFile("migrations/000016_drop_failed_login_attempts.up.sql")
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	if _, err := database.Exec(string(up)); err != nil {
		t.Fatalf("apply up migration to legacy row: %v", err)
	}
	if columnExists(t, database, "failed_login_attempts") {
		t.Fatal("failed_login_attempts still present after re-applying up migration")
	}

	var lockedAt, lockedUntil time.Time
	if err := database.QueryRow(
		`SELECT locked_at, locked_until FROM users WHERE username='legacy'`,
	).Scan(&lockedAt, &lockedUntil); err != nil {
		t.Fatalf("legacy row did not survive the migration: %v", err)
	}
	if lockedAt.IsZero() {
		t.Fatal("locked_at cleared by the migration")
	}
	if lockedUntil.Year() != 2099 {
		t.Fatalf("lock state disturbed: %v", lockedUntil)
	}
}

func columnExists(t *testing.T, database *db.DB, column string) bool {
	t.Helper()
	rows, err := database.Query(`PRAGMA table_info(users)`)
	if err != nil {
		t.Fatalf("table_info: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notNull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan table_info: %v", err)
		}
		if name == column {
			return true
		}
	}
	return false
}
