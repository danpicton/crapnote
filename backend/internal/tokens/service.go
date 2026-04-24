package tokens

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/danpicton/crapnote/internal/auth"
)

// DefaultTTL is the default lifetime applied to a new token when the caller
// does not specify one.
const DefaultTTL = 90 * 24 * time.Hour

// MaxNameLen caps the length of a token name to keep UI and logs readable.
const MaxNameLen = 80

// ErrForbidden is returned when a user is not permitted to manage API tokens
// (non-admin and their api_tokens_enabled flag is false).
var ErrForbidden = errors.New("api tokens not permitted for this user")

// ErrInvalidName is returned when a token name is empty or too long.
var ErrInvalidName = errors.New("invalid token name")

// ErrInvalidScope is returned when a provided scope value is unrecognised.
var ErrInvalidScope = errors.New("invalid scope")

// VerifiedToken is the result of a successful bearer-token verification. The
// raw secret is never returned; only the identity and authorisation envelope
// the caller needs to enforce access control.
type VerifiedToken struct {
	TokenID int64
	User    *auth.User
	Scope   Scope
}

// CreatedToken bundles a newly issued token's metadata with the raw secret.
// The raw secret (RawToken) must be returned to the caller exactly once and
// never persisted or logged.
type CreatedToken struct {
	Token    *Token
	RawToken string
}

// Service implements API-token business logic. It depends on the token repo
// for persistence and the auth user repo to resolve the owner and enforce the
// api_tokens_enabled gate.
type Service struct {
	tokens *Repo
	users  *auth.UserRepo
	now    func() time.Time
}

// NewService creates a new token Service.
func NewService(repo *Repo, users *auth.UserRepo) *Service {
	return &Service{tokens: repo, users: users, now: time.Now}
}

// Create issues a new API token for user and persists a hash of it. The raw
// token is returned in CreatedToken.RawToken and must be shown to the caller
// exactly once. Admins may always create tokens; non-admins require
// api_tokens_enabled to be true.
//
// If ttl == 0, DefaultTTL is applied. If ttl < 0, the token never expires.
func (s *Service) Create(ctx context.Context, user *auth.User, name string, scope Scope, ttl time.Duration) (*CreatedToken, error) {
	if user == nil {
		return nil, ErrForbidden
	}
	if !user.IsAdmin && !user.APITokensEnabled {
		return nil, ErrForbidden
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > MaxNameLen {
		return nil, ErrInvalidName
	}
	if !scope.Valid() {
		return nil, ErrInvalidScope
	}

	raw, displayPrefix, hash, err := generate()
	if err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}

	var expiresAt *time.Time
	switch {
	case ttl == 0:
		t := s.now().Add(DefaultTTL).UTC()
		expiresAt = &t
	case ttl > 0:
		t := s.now().Add(ttl).UTC()
		expiresAt = &t
	}

	tok, err := s.tokens.Create(ctx, user.ID, name, hash, displayPrefix, scope, expiresAt)
	if err != nil {
		return nil, err
	}
	return &CreatedToken{Token: tok, RawToken: raw}, nil
}

// Verify resolves a raw bearer token to the owning user and scope. Returns
// ErrInvalidToken for any failure (unknown, revoked, expired, malformed, or
// belonging to a user whose api_tokens_enabled was subsequently disabled).
// The same error is returned in every failure case to avoid leaking which
// condition matched.
func (s *Service) Verify(ctx context.Context, raw string) (*VerifiedToken, error) {
	if !strings.HasPrefix(raw, TokenPrefix) {
		return nil, ErrInvalidToken
	}
	hash := hashToken(raw)

	tok, err := s.tokens.FindByHash(ctx, hash)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrInvalidToken
	}
	if err != nil {
		return nil, err
	}

	// Constant-time equality: although hash was looked up by key, compare the
	// stored hash to the computed one explicitly to harden against future
	// changes that might introduce a prefix index or similar lookup.
	if subtle.ConstantTimeCompare([]byte(hash), []byte(tok.TokenHash)) != 1 {
		return nil, ErrInvalidToken
	}

	if !tok.Active(s.now()) {
		return nil, ErrInvalidToken
	}

	user, err := s.users.FindByID(ctx, tok.UserID)
	if errors.Is(err, auth.ErrNotFound) {
		return nil, ErrInvalidToken
	}
	if err != nil {
		return nil, err
	}

	// Runtime enforcement: disabling api_tokens_enabled invalidates the user's
	// tokens immediately without needing to revoke each one.
	if !user.IsAdmin && !user.APITokensEnabled {
		return nil, ErrInvalidToken
	}

	// A locked account's tokens stop working until the account is unlocked.
	if user.LockedAt != nil {
		return nil, ErrInvalidToken
	}

	return &VerifiedToken{TokenID: tok.ID, User: user, Scope: tok.Scope}, nil
}

// List returns all tokens belonging to user, most recent first. Raw secrets
// are never retrievable.
func (s *Service) List(ctx context.Context, userID int64) ([]*Token, error) {
	return s.tokens.ListByUser(ctx, userID)
}

// Revoke marks a token as revoked if it belongs to userID. Returns
// ErrNotFound if no such token exists for this user. Idempotent on re-revoke.
func (s *Service) Revoke(ctx context.Context, userID, tokenID int64) error {
	tok, err := s.tokens.FindByID(ctx, tokenID)
	if err != nil {
		return err
	}
	if tok.UserID != userID {
		// Deliberately return ErrNotFound rather than a distinct error to
		// avoid leaking existence of tokens owned by other users.
		return ErrNotFound
	}
	return s.tokens.Revoke(ctx, tokenID, s.now())
}

// RevokeAll marks every non-revoked token belonging to userID as revoked.
func (s *Service) RevokeAll(ctx context.Context, userID int64) error {
	return s.tokens.RevokeAllForUser(ctx, userID, s.now())
}

// RecordUsage updates last_used_at for the given token. Best-effort: errors
// should be logged by the caller but not surfaced to the client.
func (s *Service) RecordUsage(ctx context.Context, tokenID int64, ts time.Time) error {
	return s.tokens.UpdateLastUsed(ctx, tokenID, ts)
}

// ── token generation ────────────────────────────────────────────────────────

// generate returns (rawToken, displayPrefix, hash). The raw token is the full
// user-visible string ("cnp_..."); displayPrefix is the first DisplayPrefixLen
// characters of the random suffix (used only for UI identification); hash is
// the hex-encoded SHA-256 of the full raw token, which is what the DB stores.
func generate() (raw, displayPrefix, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", "", err
	}
	suffix := base64.RawURLEncoding.EncodeToString(b)
	raw = TokenPrefix + suffix
	displayPrefix = TokenPrefix + suffix[:DisplayPrefixLen]
	hash = hashToken(raw)
	return raw, displayPrefix, hash, nil
}

// hashToken returns the hex-encoded SHA-256 of the raw token. SHA-256 is
// chosen deliberately over bcrypt/argon2: API tokens are high-entropy (32
// random bytes = 256 bits), so brute force is infeasible regardless of hash
// function, and we want verification to stay fast on every API call.
func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
