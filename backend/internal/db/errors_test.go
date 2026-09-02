package db_test

import (
	"testing"

	"github.com/danpicton/crapnote/internal/db"
)

// The point of IsUniqueViolation is that it recognises the real driver error, so
// this provokes one rather than constructing a fake.
func TestIsUniqueViolation(t *testing.T) {
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	if _, err := database.Exec(
		`INSERT INTO users(username, password_hash) VALUES(?, ?)`, "dupe", "x",
	); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	// users.username is UNIQUE.
	_, err = database.Exec(
		`INSERT INTO users(username, password_hash) VALUES(?, ?)`, "dupe", "x",
	)
	if err == nil {
		t.Fatal("expected a UNIQUE violation on the duplicate username")
	}
	if !db.IsUniqueViolation(err) {
		t.Fatalf("IsUniqueViolation(%v) = false, want true", err)
	}

	// A foreign-key failure is a constraint error but not a uniqueness one, and
	// must keep surfacing as a genuine error.
	_, err = database.Exec(
		`INSERT INTO notes(user_id, title, body) VALUES(?, ?, ?)`, 999999, "t", "b",
	)
	if err == nil {
		t.Fatal("expected a foreign-key violation")
	}
	if db.IsUniqueViolation(err) {
		t.Fatalf("IsUniqueViolation(%v) = true for a foreign-key error, want false", err)
	}

	if db.IsUniqueViolation(nil) {
		t.Fatal("IsUniqueViolation(nil) = true, want false")
	}
}
