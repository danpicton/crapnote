package trash

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/requestctx"
)

// Repo provides access to the trash table.
type Repo struct {
	db *db.DB
}

// NewRepo creates a new trash Repo.
func NewRepo(database *db.DB) *Repo {
	return &Repo{db: database}
}

// List returns trashed notes for the given user, optionally filtered with the
// notes full-text search. limit <= 0 disables pagination.
func (r *Repo) List(ctx context.Context, userID int64, search string, limit, offset int) ([]*Entry, error) {
	query := `
		SELECT t.note_id, t.user_id, n.title, t.deleted_at
		FROM trash t
		JOIN notes n ON n.id = t.note_id
		WHERE t.user_id = ?`
	args := []any{userID}
	if requestctx.IsMCP(ctx) {
		query += ` AND n.private = 0`
	}
	if search != "" {
		escaped := strings.ReplaceAll(search, `"`, `""`)
		query += ` AND n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)`
		args = append(args, `"`+escaped+`"*`)
	}
	query += ` ORDER BY t.deleted_at DESC`
	if limit > 0 {
		query += ` LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	}
	rows, err := r.db.QueryContext(ctx, query, args...)
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
	query := `DELETE FROM trash WHERE note_id=? AND user_id=?`
	if requestctx.IsMCP(ctx) {
		query += ` AND EXISTS (SELECT 1 FROM notes n WHERE n.id=trash.note_id AND n.private=0)`
	}
	res, err := r.db.ExecContext(ctx, query, noteID, userID)
	if err != nil {
		return fmt.Errorf("restore: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// trashDeleteSQL enforces ownership, current trash membership and MCP privacy
// in the DELETE itself. A prior selection can go stale after an owner restores
// a note or changes privacy. Deleting the note cascades to its trash row.
func trashDeleteSQL(ctx context.Context) string {
	query := `DELETE FROM notes WHERE user_id=?
		AND EXISTS (SELECT 1 FROM trash t WHERE t.note_id=notes.id AND t.user_id=notes.user_id)`
	if requestctx.IsMCP(ctx) {
		query += ` AND private=0`
	}
	return query
}

// DeleteOne permanently deletes a single currently visible trashed note.
func (r *Repo) DeleteOne(ctx context.Context, noteID, userID int64) error {
	res, err := r.db.ExecContext(ctx, trashDeleteSQL(ctx)+` AND id=?`, userID, noteID)
	if err != nil {
		return fmt.Errorf("delete one: %w", err)
	}
	count, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

// Empty permanently deletes all currently visible trashed notes for a user.
func (r *Repo) Empty(ctx context.Context, userID int64) error {
	_, err := r.db.ExecContext(ctx, trashDeleteSQL(ctx), userID)
	if err != nil {
		return fmt.Errorf("empty trash: %w", err)
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
