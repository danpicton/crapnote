package db

import (
	"errors"

	"github.com/mattn/go-sqlite3"
)

// IsUniqueViolation reports whether err is the database refusing a write
// because it would duplicate a UNIQUE (or PRIMARY KEY) value.
//
// It lets a caller treat "this row is already there" as an outcome of the write
// statement itself rather than something a follow-up SELECT has to go and find
// out, which would be a second, separately-timed read. Constraint failures other
// than uniqueness — a foreign key, a NOT NULL — deliberately do not match, so
// they still surface as errors.
//
// Driver-specific by nature, which is why it lives here: internal/db is where
// the sqlite3 driver is already imported.
func IsUniqueViolation(err error) bool {
	var sqliteErr sqlite3.Error
	if !errors.As(err, &sqliteErr) {
		return false
	}
	return sqliteErr.ExtendedCode == sqlite3.ErrConstraintUnique ||
		sqliteErr.ExtendedCode == sqlite3.ErrConstraintPrimaryKey
}
