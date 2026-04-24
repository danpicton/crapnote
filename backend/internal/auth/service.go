package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
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

// ErrInviteInvalid is returned for any CompleteSetup failure mode (missing,
// expired, already-used). A single error avoids leaking which condition
// matched on a public endpoint.
var ErrInviteInvalid = errors.New("invite invalid or expired")

// Service implements authentication business logic.
type Service struct {
	users    *UserRepo
	sessions *SessionRepo
	invites  *InviteRepo
	ttl      time.Duration
}

// NewService creates a new auth Service without invite support (legacy
// callers). CreateInvite and CompleteSetup will return an error if invoked.
func NewService(users *UserRepo, sessions *SessionRepo, sessionTTL time.Duration) *Service {
	return &Service{users: users, sessions: sessions, ttl: sessionTTL}
}

// NewServiceWithInvites creates a new auth Service that supports the admin
// invite / first-login password setup flow.
func NewServiceWithInvites(users *UserRepo, sessions *SessionRepo, invites *InviteRepo, sessionTTL time.Duration) *Service {
	return &Service{users: users, sessions: sessions, invites: invites, ttl: sessionTTL}
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

// CreateInvite issues a one-time setup token for a user. The raw token is
// returned to the caller and must be shown to the admin exactly once — only
// a SHA-256 hash is persisted. Any existing invites for the user are deleted
// so regenerating a link invalidates the previous one.
func (s *Service) CreateInvite(ctx context.Context, userID int64, ttl time.Duration) (string, *Invite, error) {
	if s.invites == nil {
		return "", nil, errors.New("invites not configured")
	}
	// Purge any existing invites for this user — a regenerated link voids the
	// previous one.
	if err := s.invites.DeleteForUser(ctx, userID); err != nil {
		return "", nil, fmt.Errorf("create invite: purge old: %w", err)
	}
	raw, err := generateInviteToken()
	if err != nil {
		return "", nil, err
	}
	hash := hashInviteToken(raw)
	expires := time.Now().Add(ttl).UTC()
	inv, err := s.invites.Create(ctx, userID, hash, expires)
	if err != nil {
		return "", nil, err
	}
	return raw, inv, nil
}

// CompleteSetup consumes a setup token, bcrypt-hashes the supplied password
// and writes it to the user. It also unlocks the account and clears any
// failed-attempt counter so a freshly set up user can log in.
// Returns ErrInviteInvalid for any failure mode.
func (s *Service) CompleteSetup(ctx context.Context, rawToken, newPassword string) (*User, error) {
	if s.invites == nil {
		return nil, errors.New("invites not configured")
	}
	hash := hashInviteToken(rawToken)
	inv, err := s.invites.FindByTokenHash(ctx, hash)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrInviteInvalid
	}
	if err != nil {
		return nil, fmt.Errorf("complete setup: lookup: %w", err)
	}
	if time.Now().After(inv.ExpiresAt) {
		// Expired: clean up and report invalid.
		s.invites.Delete(ctx, inv.ID) //nolint:errcheck
		return nil, ErrInviteInvalid
	}

	pwHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcryptCost)
	if err != nil {
		return nil, fmt.Errorf("complete setup: hash: %w", err)
	}
	if err := s.users.SetPassword(ctx, inv.UserID, string(pwHash)); err != nil {
		return nil, fmt.Errorf("complete setup: set password: %w", err)
	}
	// A freshly activated user must not start out locked — admin may have
	// locked during creation, or incidental failed attempts may have ticked
	// the counter. Clear both.
	s.users.Unlock(ctx, inv.UserID) //nolint:errcheck
	// Consume the invite.
	s.invites.Delete(ctx, inv.ID) //nolint:errcheck

	return s.users.FindByID(ctx, inv.UserID)
}

// HasActiveInvite reports whether an unexpired invite exists for the user.
// Used to expose "pending setup" state in admin list views.
func (s *Service) HasActiveInvite(ctx context.Context, userID int64) (bool, error) {
	if s.invites == nil {
		return false, nil
	}
	return s.invites.HasActiveForUser(ctx, userID)
}

// ── invite token helpers ────────────────────────────────────────────────────

func generateInviteToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate invite token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

func hashInviteToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
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
