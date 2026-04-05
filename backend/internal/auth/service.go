package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// ErrInvalidCredentials is returned when username/password don't match.
var ErrInvalidCredentials = errors.New("invalid credentials")

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
// Returns ErrInvalidCredentials for unknown users or wrong passwords.
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

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

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
