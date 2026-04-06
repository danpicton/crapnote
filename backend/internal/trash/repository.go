package trash

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/danpicton/crapnote/internal/db"
)

// Repo provides access to the trash table.
type Repo struct {
	db *db.DB
}

// NewRepo creates a new trash Repo.
func NewRepo(database *db.DB) *Repo {
	return &Repo{db: database}
}

// List returns all trashed notes for the given user.
func (r *Repo) List(ctx context.Context, userID int64) ([]*Entry, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT t.note_id, t.user_id, n.title, t.deleted_at
		FROM trash t
		JOIN notes n ON n.id = t.note_id
		WHERE t.user_id = ?
		ORDER BY t.deleted_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list trash: %w", err)
	}
	defer rows.Close()

	var result []*Entry
	for rows.Next() {
		e := &Entry{}
		if err := rows.Scan(&e.NoteID, &e.UserID, &e.Title, &e.DeletedAt); err != nil {
			return nil, err
		}
		e.PermanentDeleteAt = e.DeletedAt.Add(PurgeDays * 24 * time.Hour)
		result = append(result, e)
	}
	return result, rows.Err()
}

// Restore removes a note from the trash without deleting it.
// Returns ErrNotFound if the note is not in trash or belongs to another user.
func (r *Repo) Restore(ctx context.Context, noteID, userID int64) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM trash WHERE note_id=? AND user_id=?`, noteID, userID,
	)
	if err != nil {
		return fmt.Errorf("restore: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteOne permanently deletes a single trashed note (note row + trash row).
func (r *Repo) DeleteOne(ctx context.Context, noteID, userID int64) error {
	// Verify ownership via trash table first.
	var exists int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM trash WHERE note_id=? AND user_id=?`, noteID, userID,
	).Scan(&exists); err != nil {
		return fmt.Errorf("delete one check: %w", err)
	}
	if exists == 0 {
		return ErrNotFound
	}

	// Deleting the notes row cascades to trash (ON DELETE CASCADE).
	_, err := r.db.ExecContext(ctx, `DELETE FROM notes WHERE id=? AND user_id=?`, noteID, userID)
	return err
}

// Empty permanently deletes all trashed notes for a user.
func (r *Repo) Empty(ctx context.Context, userID int64) error {
	// Collect note IDs first, then delete notes (trash rows cascade).
	rows, err := r.db.QueryContext(ctx,
		`SELECT note_id FROM trash WHERE user_id=?`, userID,
	)
	if err != nil {
		return fmt.Errorf("empty trash query: %w", err)
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, id := range ids {
		if _, err := r.db.ExecContext(ctx,
			`DELETE FROM notes WHERE id=? AND user_id=?`, id, userID,
		); err != nil {
			return fmt.Errorf("empty trash delete %d: %w", id, err)
		}
	}
	return nil
}

// PurgeExpired permanently deletes all notes that have been in trash for
// longer than PurgeDays days. Safe to call from a background goroutine.
func (r *Repo) PurgeExpired(ctx context.Context) error {
	cutoff := time.Now().Add(-PurgeDays * 24 * time.Hour).UTC()

	rows, err := r.db.QueryContext(ctx,
		`SELECT note_id FROM trash WHERE deleted_at < ?`, cutoff,
	)
	if err != nil {
		return fmt.Errorf("purge expired query: %w", err)
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if rows.Err() != nil {
		return rows.Err()
	}

	for _, id := range ids {
		if _, err := r.db.ExecContext(ctx, `DELETE FROM notes WHERE id=?`, id); err != nil {
			return fmt.Errorf("purge note %d: %w", id, err)
		}
	}
	return nil
}

// Ensure ErrNotFound is exported from the sql package check path.
var _ = sql.ErrNoRows
var _ = errors.New
