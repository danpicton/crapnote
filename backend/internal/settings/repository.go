package settings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/danpicton/crapnote/internal/db"
)

// Repo provides access to the app_settings key/value table.
type Repo struct {
	db *db.DB
}

// NewRepo creates a new settings Repo.
func NewRepo(database *db.DB) *Repo {
	return &Repo{db: database}
}

// Get returns the stored value for key, or ErrNotFound.
func (r *Repo) Get(ctx context.Context, key string) (string, error) {
	var v string
	err := r.db.QueryRowContext(ctx,
		`SELECT value FROM app_settings WHERE key = ?`, key,
	).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get setting %q: %w", key, err)
	}
	return v, nil
}

// Set stores value under key, replacing any existing value.
func (r *Repo) Set(ctx context.Context, key, value string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO app_settings(key, value) VALUES(?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
		key, value,
	)
	if err != nil {
		return fmt.Errorf("set setting %q: %w", key, err)
	}
	return nil
}
