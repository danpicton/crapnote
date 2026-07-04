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
	LockedUntil         *time.Time
	CreatedAt           time.Time
}

// Locked reports whether the account's lock is active at the given time.
// Manual admin locks have no LockedUntil and are indefinite; automatic
// failed-login locks carry a LockedUntil and lapse once it passes. Callers
// that can write (e.g. Login) should also clear a lapsed lock via
// UserRepo.Unlock so the stored state catches up.
func (u *User) Locked(now time.Time) bool {
	if u.LockedAt == nil {
		return false
	}
	if u.LockedUntil != nil && !now.Before(*u.LockedUntil) {
		return false
	}
	return true
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
