package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// MaxFailedLoginAttempts is the number of consecutive failed password attempts
// after which a non-admin account is locked.
const MaxFailedLoginAttempts = 3

// ErrInvalidCredentials is returned when username/password don't match.
var ErrInvalidCredentials = errors.New("invalid credentials")

// ErrAccountLocked is returned when a locked user attempts to authenticate.
var ErrAccountLocked = errors.New("account locked")

// Service implements authentication business logic.
type Service struct {
	users    *UserRepo
	sessions *SessionRepo
	ttl      time.Duration
}

// NewService creates a new auth Service.
func NewService(users *UserRepo, sessions *SessionRepo, sessionTTL time.Duration) *Service {
	return &Service{users: users, sessions: sessions, ttl: sessionTTL}
}

// SeedAdmin creates the initial admin user if no users exist yet.
// It is a no-op if users already exist.
func (s *Service) SeedAdmin(ctx context.Context, username, password string) error {
	n, err := s.users.Count(ctx)
	if err != nil {
		return fmt.Errorf("seed admin: count: %w", err)
	}
	if n > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return fmt.Errorf("seed admin: hash: %w", err)
	}

	if _, err := s.users.Create(ctx, username, string(hash), true); err != nil {
		return fmt.Errorf("seed admin: create: %w", err)
	}
	return nil
}

// Login verifies credentials and returns a new Session on success.
// Returns ErrInvalidCredentials for unknown users or wrong passwords, and
// ErrAccountLocked for users whose accounts have been locked (either by an
// admin or by exceeding MaxFailedLoginAttempts).
func (s *Service) Login(ctx context.Context, username, password string) (*Session, error) {
	u, err := s.users.FindByUsername(ctx, username)
	if errors.Is(err, ErrNotFound) {
		// Perform a dummy comparison to avoid timing attacks.
		bcrypt.CompareHashAndPassword([]byte("$2a$12$dummy"), []byte(password)) //nolint:errcheck
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("login: %w", err)
	}

	if u.LockedAt != nil {
		// Still perform a dummy comparison to keep timing uniform.
		bcrypt.CompareHashAndPassword([]byte("$2a$12$dummy"), []byte(password)) //nolint:errcheck
		return nil, ErrAccountLocked
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		// Only non-admin accounts are subject to automatic lockout. Admins are
		// exempt so a brute-force attempt cannot strand the system with no one
		// able to unlock anyone.
		if !u.IsAdmin {
			n, incErr := s.users.IncrementFailedAttempts(ctx, u.ID)
			if incErr == nil && n >= MaxFailedLoginAttempts {
				s.users.Lock(ctx, u.ID) //nolint:errcheck
			}
		}
		return nil, ErrInvalidCredentials
	}

	// Successful login — clear the failed-attempt counter.
	s.users.ResetFailedAttempts(ctx, u.ID) //nolint:errcheck

	exp := time.Now().Add(s.ttl).UTC()
	sess, err := s.sessions.Create(ctx, u.ID, exp)
	if err != nil {
		return nil, fmt.Errorf("login: create session: %w", err)
	}
	return sess, nil
}

// Logout deletes the session immediately.
func (s *Service) Logout(ctx context.Context, sessionID string) error {
	return s.sessions.Delete(ctx, sessionID)
}

// ChangePassword updates a user's password after verifying the current one.
// Returns ErrInvalidCredentials if the current password is wrong.
func (s *Service) ChangePassword(ctx context.Context, userID int64, currentPassword, newPassword string) error {
	u, err := s.users.FindByID(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		return ErrInvalidCredentials
	}
	if err != nil {
		return fmt.Errorf("change password: lookup: %w", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(currentPassword)); err != nil {
		return ErrInvalidCredentials
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcryptCost)
	if err != nil {
		return fmt.Errorf("change password: hash: %w", err)
	}
	return s.users.SetPassword(ctx, userID, string(hash))
}

// ValidateSession returns the User associated with the session if it exists
// and has not expired. Returns ErrNotFound if missing or expired.
func (s *Service) ValidateSession(ctx context.Context, sessionID string) (*User, error) {
	sess, err := s.sessions.Find(ctx, sessionID)
	if err != nil {
		return nil, err // already ErrNotFound or a wrapped error
	}
	if time.Now().After(sess.ExpiresAt) {
		s.sessions.Delete(ctx, sessionID) //nolint:errcheck
		return nil, ErrNotFound
	}
	return s.users.FindByID(ctx, sess.UserID)
}
