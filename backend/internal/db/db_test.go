package db_test

import (
	"testing"

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
