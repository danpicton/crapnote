//go:build sqlite_fts5

// This file is intentionally empty. Its sole purpose is to enforce that the
// sqlite_fts5 build tag is always present when compiling this package, so that
// the FTS5 full-text search module is available in the embedded SQLite.
package db
