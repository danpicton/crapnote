package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/danpicton/crapnote/internal/db"
)

// ErrNotFound is returned when a requested record does not exist.
var ErrNotFound = errors.New("not found")

// ── User repository ──────────────────────────────────────────────────────────

// UserRepo provides access to the users table.
type UserRepo struct {
	db *db.DB
}

// NewUserRepo creates a new UserRepo backed by the given database.
func NewUserRepo(database *db.DB) *UserRepo {
	return &UserRepo{db: database}
}

// Create inserts a new user and returns the populated User.
func (r *UserRepo) Create(ctx context.Context, username, passwordHash string, isAdmin bool) (*User, error) {
	isAdminInt := 0
	if isAdmin {
		isAdminInt = 1
	}
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO users(username, password_hash, is_admin) VALUES(?, ?, ?)`,
		username, passwordHash, isAdminInt,
	)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("last insert id: %w", err)
	}
	return r.FindByID(ctx, id)
}

// FindByUsername returns the user with the given username, or ErrNotFound.
func (r *UserRepo) FindByUsername(ctx context.Context, username string) (*User, error) {
	u := &User{}
	var isAdmin, apiTokensEnabled int
	var lockedAt sql.NullTime
	err := r.db.QueryRowContext(ctx,
		`SELECT id, username, password_hash, is_admin, api_tokens_enabled, failed_login_attempts, locked_at, created_at FROM users WHERE username=?`,
		username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &isAdmin, &apiTokensEnabled, &u.FailedLoginAttempts, &lockedAt, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find user by username: %w", err)
	}
	u.IsAdmin = isAdmin != 0
	u.APITokensEnabled = apiTokensEnabled != 0
	if lockedAt.Valid {
		t := lockedAt.Time
		u.LockedAt = &t
	}
	return u, nil
}

// FindByID returns the user with the given id, or ErrNotFound.
func (r *UserRepo) FindByID(ctx context.Context, id int64) (*User, error) {
	u := &User{}
	var isAdmin, apiTokensEnabled int
	var lockedAt sql.NullTime
	err := r.db.QueryRowContext(ctx,
		`SELECT id, username, password_hash, is_admin, api_tokens_enabled, failed_login_attempts, locked_at, created_at FROM users WHERE id=?`,
		id,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &isAdmin, &apiTokensEnabled, &u.FailedLoginAttempts, &lockedAt, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find user by id: %w", err)
	}
	u.IsAdmin = isAdmin != 0
	u.APITokensEnabled = apiTokensEnabled != 0
	if lockedAt.Valid {
		t := lockedAt.Time
		u.LockedAt = &t
	}
	return u, nil
}

// IncrementFailedAttempts bumps the failed login counter and returns the new
// value. Returns ErrNotFound if the user does not exist.
func (r *UserRepo) IncrementFailedAttempts(ctx context.Context, id int64) (int, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id=?`, id)
	if err != nil {
		return 0, fmt.Errorf("increment failed attempts: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return 0, ErrNotFound
	}
	var count int
	if err := r.db.QueryRowContext(ctx,
		`SELECT failed_login_attempts FROM users WHERE id=?`, id,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("read failed attempts: %w", err)
	}
	return count, nil
}

// ResetFailedAttempts zeroes the failed login counter.
func (r *UserRepo) ResetFailedAttempts(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE users SET failed_login_attempts = 0 WHERE id=?`, id)
	if err != nil {
		return fmt.Errorf("reset failed attempts: %w", err)
	}
	return nil
}

// Lock marks the account as locked (sets locked_at to now).
func (r *UserRepo) Lock(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE users SET locked_at = CURRENT_TIMESTAMP WHERE id=?`, id)
	if err != nil {
		return fmt.Errorf("lock user: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// Unlock clears the lock and resets the failed attempts counter.
func (r *UserRepo) Unlock(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE users SET locked_at = NULL, failed_login_attempts = 0 WHERE id=?`, id)
	if err != nil {
		return fmt.Errorf("unlock user: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetPassword updates a user's stored password hash.
// Returns ErrNotFound if the user does not exist.
func (r *UserRepo) SetPassword(ctx context.Context, id int64, passwordHash string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE users SET password_hash=? WHERE id=?`, passwordHash, id)
	if err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetAPITokensEnabled toggles whether a (non-admin) user may create API
// tokens. Returns ErrNotFound if the user does not exist.
func (r *UserRepo) SetAPITokensEnabled(ctx context.Context, id int64, enabled bool) error {
	v := 0
	if enabled {
		v = 1
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE users SET api_tokens_enabled=? WHERE id=?`, v, id,
	)
	if err != nil {
		return fmt.Errorf("set api_tokens_enabled: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// Count returns the total number of users.
func (r *UserRepo) Count(ctx context.Context) (int, error) {
	var n int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return 0, fmt.Errorf("count users: %w", err)
	}
	return n, nil
}

// Delete removes a user and all their associated data (cascaded via FK).
func (r *UserRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM users WHERE id=?`, id)
	return err
}

// List returns users ordered by created_at. limit <= 0 returns all users.
func (r *UserRepo) List(ctx context.Context, limit, offset int) ([]*User, error) {
	query := `SELECT id, username, password_hash, is_admin, api_tokens_enabled, failed_login_attempts, locked_at, created_at FROM users ORDER BY created_at`
	var args []any
	if limit > 0 {
		query += ` LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	}
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		u := &User{}
		var isAdmin, apiTokensEnabled int
		var lockedAt sql.NullTime
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &isAdmin, &apiTokensEnabled, &u.FailedLoginAttempts, &lockedAt, &u.CreatedAt); err != nil {
			return nil, err
		}
		u.IsAdmin = isAdmin != 0
		u.APITokensEnabled = apiTokensEnabled != 0
		if lockedAt.Valid {
			t := lockedAt.Time
			u.LockedAt = &t
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// ── Session repository ───────────────────────────────────────────────────────

// SessionRepo provides access to the sessions table.
type SessionRepo struct {
	db *db.DB
}

// NewSessionRepo creates a new SessionRepo backed by the given database.
func NewSessionRepo(database *db.DB) *SessionRepo {
	return &SessionRepo{db: database}
}

// Create generates a new session ID, inserts the session, and returns it.
func (r *SessionRepo) Create(ctx context.Context, userID int64, expiresAt time.Time) (*Session, error) {
	id, err := generateSessionID()
	if err != nil {
		return nil, fmt.Errorf("generate session id: %w", err)
	}

	_, err = r.db.ExecContext(ctx,
		`INSERT INTO sessions(id, user_id, expires_at) VALUES(?, ?, ?)`,
		id, userID, expiresAt.UTC(),
	)
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}

	return r.Find(ctx, id)
}

// Find returns the session with the given ID, or ErrNotFound.
func (r *SessionRepo) Find(ctx context.Context, id string) (*Session, error) {
	s := &Session{}
	err := r.db.QueryRowContext(ctx,
		`SELECT id, user_id, expires_at, created_at FROM sessions WHERE id=?`, id,
	).Scan(&s.ID, &s.UserID, &s.ExpiresAt, &s.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find session: %w", err)
	}
	return s, nil
}

// Delete removes a session by ID (used on logout).
func (r *SessionRepo) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM sessions WHERE id=?`, id)
	return err
}

// DeleteExpired removes all sessions whose expires_at is in the past.
func (r *SessionRepo) DeleteExpired(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP`,
	)
	return err
}

// generateSessionID returns a cryptographically random 32-byte hex string.
func generateSessionID() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
