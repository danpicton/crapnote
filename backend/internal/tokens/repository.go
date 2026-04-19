package tokens

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/danpicton/crapnote/internal/db"
)

// Repo provides access to the api_tokens table.
type Repo struct {
	db *db.DB
}

// NewRepo creates a new Repo backed by the given database.
func NewRepo(database *db.DB) *Repo {
	return &Repo{db: database}
}

// Create inserts a new token record and returns the populated Token.
func (r *Repo) Create(ctx context.Context, userID int64, name, tokenHash, prefix string, scope Scope, expiresAt *time.Time) (*Token, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO api_tokens(user_id, name, token_hash, prefix, scope, expires_at)
		 VALUES(?, ?, ?, ?, ?, ?)`,
		userID, name, tokenHash, prefix, string(scope), expiresAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create token: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("last insert id: %w", err)
	}
	return r.FindByID(ctx, id)
}

// FindByID returns the token with the given id, or ErrNotFound.
func (r *Repo) FindByID(ctx context.Context, id int64) (*Token, error) {
	return r.scanOne(r.db.QueryRowContext(ctx, selectColumns+` WHERE id=?`, id))
}

// FindByHash returns the token matching tokenHash, or ErrNotFound.
func (r *Repo) FindByHash(ctx context.Context, tokenHash string) (*Token, error) {
	return r.scanOne(r.db.QueryRowContext(ctx, selectColumns+` WHERE token_hash=?`, tokenHash))
}

// ListByUser returns all tokens for the user, most recent first.
func (r *Repo) ListByUser(ctx context.Context, userID int64) ([]*Token, error) {
	rows, err := r.db.QueryContext(ctx,
		selectColumns+` WHERE user_id=? ORDER BY created_at DESC`, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list tokens: %w", err)
	}
	defer rows.Close()

	var out []*Token
	for rows.Next() {
		t, err := scanRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Revoke marks the token as revoked. No-op if already revoked. Returns
// ErrNotFound if the token does not exist.
func (r *Repo) Revoke(ctx context.Context, id int64, now time.Time) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE api_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL`,
		now.UTC(), id,
	)
	if err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Either the row is missing or already revoked. Check which.
		if _, err := r.FindByID(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

// RevokeAllForUser marks every non-revoked token belonging to userID as
// revoked. Used when an admin disables API tokens for a user.
func (r *Repo) RevokeAllForUser(ctx context.Context, userID int64, now time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE api_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`,
		now.UTC(), userID,
	)
	if err != nil {
		return fmt.Errorf("revoke all tokens: %w", err)
	}
	return nil
}

// UpdateLastUsed sets last_used_at for the given token. Best-effort: errors are
// returned but the caller should not fail the request on failure.
func (r *Repo) UpdateLastUsed(ctx context.Context, id int64, ts time.Time) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE api_tokens SET last_used_at=? WHERE id=?`, ts.UTC(), id,
	)
	return err
}

const selectColumns = `SELECT id, user_id, name, token_hash, prefix, scope,
	last_used_at, expires_at, revoked_at, created_at FROM api_tokens`

type rowScanner interface {
	Scan(dest ...any) error
}

func (r *Repo) scanOne(row rowScanner) (*Token, error) {
	t, err := scanRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

func scanRow(row rowScanner) (*Token, error) {
	t := &Token{}
	var (
		scope      string
		lastUsed   sql.NullTime
		expiresAt  sql.NullTime
		revokedAt  sql.NullTime
	)
	err := row.Scan(
		&t.ID, &t.UserID, &t.Name, &t.TokenHash, &t.Prefix, &scope,
		&lastUsed, &expiresAt, &revokedAt, &t.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	t.Scope = Scope(scope)
	if lastUsed.Valid {
		t.LastUsedAt = &lastUsed.Time
	}
	if expiresAt.Valid {
		t.ExpiresAt = &expiresAt.Time
	}
	if revokedAt.Valid {
		t.RevokedAt = &revokedAt.Time
	}
	return t, nil
}
