// Package tokens provides personal API tokens for bearer authentication.
//
// Tokens are issued to users so external clients (CLIs, scripts) can access
// the API without a browser session. The raw token is shown exactly once on
// creation; the database stores only a SHA-256 hash, so the raw secret cannot
// be recovered or leaked from the DB. Each token carries a scope (read or
// read+write), an optional expiry, and an optional revocation timestamp.
package tokens

import (
	"errors"
	"time"
)

// TokenPrefix is the human-recognisable prefix applied to every issued token.
// Makes tokens greppable in logs and lets secret-scanners identify them.
const TokenPrefix = "cnp_"

// DisplayPrefixLen is the number of raw-secret characters stored alongside the
// hash so the UI can show "cnp_abc12345…" without retaining the full secret.
const DisplayPrefixLen = 8

// ErrNotFound is returned when a requested token does not exist.
var ErrNotFound = errors.New("not found")

// ErrInvalidToken is returned when a presented bearer token is malformed,
// unknown, expired, or revoked.
var ErrInvalidToken = errors.New("invalid token")

// Scope enumerates the permissions a token can hold.
type Scope string

const (
	// ScopeRead permits read-only API calls (GET and equivalent).
	ScopeRead Scope = "read"
	// ScopeReadWrite permits all API calls except admin-only endpoints.
	ScopeReadWrite Scope = "read_write"
)

// Valid reports whether s is a recognised scope value.
func (s Scope) Valid() bool {
	switch s {
	case ScopeRead, ScopeReadWrite:
		return true
	}
	return false
}

// AllowsWrite reports whether the scope permits mutating operations.
func (s Scope) AllowsWrite() bool {
	return s == ScopeReadWrite
}

// Token is a stored API token record. The raw secret never lives on this
// struct; only its SHA-256 hash and display prefix are persisted.
type Token struct {
	ID         int64
	UserID     int64
	Name       string
	TokenHash  string
	Prefix     string
	Scope      Scope
	LastUsedAt *time.Time
	ExpiresAt  *time.Time
	RevokedAt  *time.Time
	CreatedAt  time.Time
}

// Active reports whether the token is currently usable for authentication.
func (t *Token) Active(now time.Time) bool {
	if t.RevokedAt != nil {
		return false
	}
	if t.ExpiresAt != nil && !now.Before(*t.ExpiresAt) {
		return false
	}
	return true
}
