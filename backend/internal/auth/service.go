package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// DefaultMaxFailedLoginAttempts is the default number of consecutive failed
// password attempts after which a non-admin account is auto-locked. Tunable
// via Service.SetLockoutPolicy (MAX_FAILED_LOGIN_ATTEMPTS env var in main).
const DefaultMaxFailedLoginAttempts = 5

// DefaultLockoutCooldown is how long an automatic failed-login lock lasts
// before it lapses on its own. Manual admin locks never lapse. Tunable via
// Service.SetLockoutPolicy (LOCKOUT_COOLDOWN_MINUTES env var in main).
const DefaultLockoutCooldown = 15 * time.Minute

// dummyPasswordHash is a syntactically valid, precomputed cost-12 bcrypt hash
// of a throwaway placeholder string. Login compares against it on the
// unknown-user and locked-user branches so those paths perform the same
// key-derivation work as a real password check — an invalid hash literal
// would fail during parsing and return in microseconds, letting an attacker
// enumerate usernames by response time.
var dummyPasswordHash = []byte("$2a$12$.6Huiifna4soSOzjPCMbPuaSQLzCYttSFwT5OAZXD6c1sVEdDv1IC")

// ErrInvalidCredentials is returned when username/password don't match.
var ErrInvalidCredentials = errors.New("invalid credentials")

// ErrAccountLocked is returned when an authenticated-but-locked user attempts
// to log in. It is only ever returned once the submitted password has been
// verified: returning it for a wrong guess would turn the distinct "locked"
// response into a username oracle (issue #62).
var ErrAccountLocked = errors.New("account locked")

// ErrAccountCooldown is the automatic-lockout flavour of ErrAccountLocked —
// a self-clearing failed-attempt cool-down rather than an indefinite admin
// lock. It wraps ErrAccountLocked so callers that only care about "locked"
// keep working with errors.Is; callers that render advice to the user can
// tell the two apart, because "contact an administrator" is wrong for a lock
// that lapses on its own.
var ErrAccountCooldown = fmt.Errorf("%w: login cool-down active", ErrAccountLocked)

// ErrLoginNotConfigured is returned by Login when the Service was built with
// a zero session TTL. Such a service cannot mint a usable session — the
// session would expire at the instant it was created — so this is a
// construction bug in the caller, not an authentication failure.
var ErrLoginNotConfigured = errors.New("auth service not configured for login: zero session TTL")

// ErrInviteInvalid is returned for any CompleteSetup failure mode (missing,
// expired, already-used). A single error avoids leaking which condition
// matched on a public endpoint.
var ErrInviteInvalid = errors.New("invite invalid or expired")

// Service implements authentication business logic.
type Service struct {
	users             *UserRepo
	sessions          *SessionRepo
	invites           *InviteRepo
	ttl               time.Duration
	maxFailedAttempts int
	lockoutCooldown   time.Duration
}

// NewService creates a new auth Service without invite support (legacy
// callers). CreateInvite and CompleteSetup will return an error if invoked.
func NewService(users *UserRepo, sessions *SessionRepo, sessionTTL time.Duration) *Service {
	return &Service{
		users: users, sessions: sessions, ttl: sessionTTL,
		maxFailedAttempts: DefaultMaxFailedLoginAttempts,
		lockoutCooldown:   DefaultLockoutCooldown,
	}
}

// NewServiceWithInvites creates a new auth Service that supports the admin
// invite / first-login password setup flow.
func NewServiceWithInvites(users *UserRepo, sessions *SessionRepo, invites *InviteRepo, sessionTTL time.Duration) *Service {
	return &Service{
		users: users, sessions: sessions, invites: invites, ttl: sessionTTL,
		maxFailedAttempts: DefaultMaxFailedLoginAttempts,
		lockoutCooldown:   DefaultLockoutCooldown,
	}
}

// SetLockoutPolicy overrides the automatic-lockout tuning. maxAttempts < 1
// keeps the current threshold; cooldown <= 0 makes automatic locks indefinite
// (pre-cool-down behaviour, admin unlock required).
func (s *Service) SetLockoutPolicy(maxAttempts int, cooldown time.Duration) {
	if maxAttempts >= 1 {
		s.maxFailedAttempts = maxAttempts
	}
	s.lockoutCooldown = cooldown
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
//
// Returns ErrInvalidCredentials for unknown users and for wrong passwords —
// including a wrong password against a locked account. Lock state is only
// disclosed to a caller who supplied the correct password: ErrAccountLocked
// for an indefinite admin lock, ErrAccountCooldown (which wraps it) for a
// self-clearing failed-attempt cool-down. Returns ErrLoginNotConfigured if
// the Service was constructed with a zero session TTL.
func (s *Service) Login(ctx context.Context, username, password string) (*Session, error) {
	// Checked before the user lookup and before any password comparison. The
	// outcome depends only on how this Service was constructed, never on the
	// supplied credentials, so failing first leaks nothing an attacker could
	// use — it is uniform for every request — while avoiding both the bcrypt
	// work and, more importantly, the write side effects further down
	// (failed-attempt increments, auto-lock, session revocation) on behalf of
	// a service that could never have returned a usable session anyway.
	if s.ttl <= 0 {
		return nil, ErrLoginNotConfigured
	}

	u, err := s.users.FindByUsername(ctx, username)
	if errors.Is(err, ErrNotFound) {
		// Perform a dummy comparison to avoid timing attacks.
		bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password)) //nolint:errcheck
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("login: %w", err)
	}

	// A lock whose cool-down has already lapsed is stale state, not a
	// decision: clear it (which also resets the failed-attempt counter) so
	// this attempt is judged on its own merits. Doing it before the password
	// check discloses nothing — the response is identical either way — and
	// keeps the failure path below from counting a fresh miss on top of the
	// counter that produced the expired lock.
	if u.LockedAt != nil && !u.Locked(time.Now()) {
		if err := s.users.Unlock(ctx, u.ID); err != nil {
			return nil, fmt.Errorf("login: clear lapsed lock: %w", err)
		}
		u.LockedAt, u.LockedUntil = nil, nil
		u.FailedLoginAttempts = 0
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		// Only non-admin accounts are subject to automatic lockout. Admins are
		// exempt so a brute-force attempt cannot strand the system with no one
		// able to unlock anyone.
		if !u.IsAdmin {
			n, incErr := s.users.IncrementFailedAttempts(ctx, u.ID)
			if incErr == nil && n >= s.maxFailedAttempts {
				if s.lockoutCooldown > 0 {
					s.users.LockUntil(ctx, u.ID, time.Now().Add(s.lockoutCooldown)) //nolint:errcheck
				} else {
					s.users.Lock(ctx, u.ID) //nolint:errcheck
				}
				// Lockout implies the account may be under attack — evict any
				// established sessions rather than leaving them live, via the
				// revocation choke-point so audit hooks cover this path too.
				s.RevokeUserSessions(ctx, u.ID) //nolint:errcheck
			}
		}
		// Deliberately the same answer whether or not the account is locked.
		// The lock is only disclosed to a caller who proved they hold the
		// password; anyone else gets the generic failure an unknown username
		// would get, so the response cannot be used to enumerate accounts.
		return nil, ErrInvalidCredentials
	}

	// The password checked out, so the caller is the account owner (or already
	// holds their credential) and the lock state can safely be disclosed.
	// Still no session: a locked account grants nothing.
	if u.LockedAt != nil {
		if u.LockedUntil != nil {
			return nil, ErrAccountCooldown
		}
		return nil, ErrAccountLocked
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

// RevokeUserSessions deletes every session belonging to a user. It is the
// single choke-point for session revocation so credential-change, account-lock
// and admin-reset flows all share one path — any future audit entry,
// revoked-reason column or rate limit can be added here rather than in each
// caller.
func (s *Service) RevokeUserSessions(ctx context.Context, userID int64) error {
	return s.sessions.DeleteForUser(ctx, userID)
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
	// Setting a new credential revokes any sessions established under the old
	// one — an admin regenerating an invite is often resetting a compromised
	// or offboarded account. The password is already set; a revocation failure
	// is a degraded-security outcome, not a reason to fail the setup, so we log
	// and continue.
	if err := s.RevokeUserSessions(ctx, inv.UserID); err != nil {
		slog.Error("audit: session revocation failed during setup completion",
			"event", "session_revocation_failed",
			"user_id", inv.UserID,
			"error", err,
		)
	}

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

// UserByID looks up a user by their ID. Used by handlers that need to write
// a user response after a flow that only yielded a session/user-id.
func (s *Service) UserByID(ctx context.Context, id int64) (*User, error) {
	return s.users.FindByID(ctx, id)
}

// ChangePassword sets a new password for the authenticated user. The current
// password is intentionally NOT required: a logged-in user who has forgotten
// their password should still be able to set a new one without an admin
// reset. Authenticity is enforced at the handler layer (cookie auth only).
func (s *Service) ChangePassword(ctx context.Context, userID int64, newPassword string) error {
	if _, err := s.users.FindByID(ctx, userID); err != nil {
		return fmt.Errorf("change password: lookup: %w", err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcryptCost)
	if err != nil {
		return fmt.Errorf("change password: hash: %w", err)
	}
	if err := s.users.SetPassword(ctx, userID, string(hash)); err != nil {
		return err
	}
	// Revoke every existing session so a credential change evicts anyone
	// holding an old cookie (including a possible attacker). The caller is
	// logged out too; the SPA simply re-authenticates.
	//
	// The new password is already committed here. If revocation fails we log
	// and still report success: telling the caller the change failed would be
	// wrong (it didn't) and would invite a confusing retry against
	// already-changed state. The worst case is degraded security — old sessions
	// linger — not a failed change.
	if err := s.RevokeUserSessions(ctx, userID); err != nil {
		slog.Error("audit: session revocation failed after password change",
			"event", "session_revocation_failed",
			"user_id", userID,
			"error", err,
		)
	}
	return nil
}

// ValidateSession returns the User associated with the session if it exists
// and has not expired. Returns ErrNotFound if the session is missing or
// expired, and ErrAccountLocked if the session is valid but the user has since
// been locked — a locked account's sessions stop working immediately, mirroring
// the bearer-token path. Distinguishing the two lets the middleware report the
// reason rather than conflating a lock with an ordinary expired session.
func (s *Service) ValidateSession(ctx context.Context, sessionID string) (*User, error) {
	sess, err := s.sessions.Find(ctx, sessionID)
	if err != nil {
		return nil, err // already ErrNotFound or a wrapped error
	}
	if time.Now().After(sess.ExpiresAt) {
		s.sessions.Delete(ctx, sessionID) //nolint:errcheck
		return nil, ErrNotFound
	}
	u, err := s.users.FindByID(ctx, sess.UserID)
	if err != nil {
		return nil, err
	}
	if u.Locked(time.Now()) {
		// Self-heal: locking normally revokes the user's sessions, but that
		// revocation is logged rather than fatal. Drop the row we just
		// rejected so a failed revocation cannot leave a session that
		// DeleteExpired will never reap, as on the expiry path above.
		s.sessions.Delete(ctx, sessionID) //nolint:errcheck
		return nil, ErrAccountLocked
	}
	return u, nil
}
