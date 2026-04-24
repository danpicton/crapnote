package auth

import "time"

// User represents an application user.
type User struct {
	ID                  int64
	Username            string
	PasswordHash        string
	IsAdmin             bool
	APITokensEnabled    bool
	FailedLoginAttempts int
	LockedAt            *time.Time
	CreatedAt           time.Time
}

// Session represents an authenticated session stored in the database.
type Session struct {
	ID        string
	UserID    int64
	ExpiresAt time.Time
	CreatedAt time.Time
}

// Invite represents a one-time password-setup token issued to a new user by
// an admin. The raw token is never stored — only its SHA-256 hash.
type Invite struct {
	ID        int64
	UserID    int64
	TokenHash string
	ExpiresAt time.Time
	CreatedAt time.Time
}
