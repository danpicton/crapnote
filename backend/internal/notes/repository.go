package notes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/danpicton/crapnote/internal/db"
)

// Repo provides access to the notes table.
type Repo struct {
	db *db.DB
}

// NewRepo creates a new notes Repo.
func NewRepo(database *db.DB) *Repo {
	return &Repo{db: database}
}

// Create inserts a new note and returns it.
func (r *Repo) Create(ctx context.Context, userID int64, title, body string) (*Note, error) {
	now := time.Now().UTC()
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO notes(user_id, title, body, created_at, updated_at) VALUES(?, ?, ?, ?, ?)`,
		userID, title, body, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("create note: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("last insert id: %w", err)
	}
	return r.Get(ctx, id, userID)
}

// Get returns a note by ID for the given user, excluding trashed and archived notes.
// Returns ErrNotFound if not found, trashed, archived, or owned by a different user.
func (r *Repo) Get(ctx context.Context, id, userID int64) (*Note, error) {
	n := &Note{}
	var starred, pinned, archived int
	err := r.db.QueryRowContext(ctx, `
		SELECT n.id, n.user_id, n.title, n.body, n.starred, n.pinned, n.archived,
		       n.created_at, n.updated_at
		FROM notes n
		WHERE n.id = ? AND n.user_id = ?
		  AND n.archived = 0
		  AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.note_id = n.id)
	`, id, userID).Scan(
		&n.ID, &n.UserID, &n.Title, &n.Body,
		&starred, &pinned, &archived, &n.CreatedAt, &n.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get note: %w", err)
	}
	n.Starred = starred != 0
	n.Pinned = pinned != 0
	n.Archived = archived != 0
	return n, nil
}

// List returns all non-trashed notes for a user, with optional filters.
// Pinned notes appear first, then ordered by updated_at DESC.
func (r *Repo) List(ctx context.Context, userID int64, filter ListFilter) ([]*Note, error) {
	query := `
		SELECT n.id, n.user_id, n.title, n.body, n.starred, n.pinned, n.archived,
		       n.created_at, n.updated_at
		FROM notes n
		WHERE n.user_id = ?
		  AND n.archived = 0
		  AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.note_id = n.id)`

	args := []any{userID}

	if filter.Starred != nil {
		if *filter.Starred {
			query += ` AND n.starred = 1`
		} else {
			query += ` AND n.starred = 0`
		}
	}

	if filter.TagID != nil {
		query += ` AND EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag_id = ?)`
		args = append(args, *filter.TagID)
	}

	if filter.Search != "" {
		// Wrap the term in double-quotes for a literal phrase prefix match.
		// Internal double-quotes are escaped by doubling ("" is the FTS5 escape
		// sequence for a literal quote within a phrase), rather than stripping them.
		escaped := strings.ReplaceAll(filter.Search, `"`, `""`)
		query += ` AND n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)`
		args = append(args, `"`+escaped+`"*`)
	}

	query += ` ORDER BY n.pinned DESC, n.updated_at DESC`

	if filter.Limit > 0 {
		query += ` LIMIT ? OFFSET ?`
		args = append(args, filter.Limit, filter.Offset)
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	defer rows.Close()

	var result []*Note
	for rows.Next() {
		n := &Note{}
		var starred, pinned, archived int
		if err := rows.Scan(
			&n.ID, &n.UserID, &n.Title, &n.Body,
			&starred, &pinned, &archived, &n.CreatedAt, &n.UpdatedAt,
		); err != nil {
			return nil, err
		}
		n.Starred = starred != 0
		n.Pinned = pinned != 0
		n.Archived = archived != 0
		result = append(result, n)
	}
	return result, rows.Err()
}

// Update performs a partial update of a note's title and/or body. Only non-nil
// fields are written; the other field keeps its current value.
// Returns ErrNotFound if the note does not exist or belongs to a different user.
func (r *Repo) Update(ctx context.Context, id, userID int64, title, body *string) (*Note, error) {
	now := time.Now().UTC()
	res, err := r.db.ExecContext(ctx, `
		UPDATE notes
		SET title      = CASE WHEN ? IS NOT NULL THEN ? ELSE title END,
		    body       = CASE WHEN ? IS NOT NULL THEN ? ELSE body  END,
		    updated_at = ?
		WHERE id = ? AND user_id = ?`,
		title, title, body, body, now, id, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("update note: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return nil, ErrNotFound
	}
	return r.Get(ctx, id, userID)
}

// SetStarred toggles the starred flag for a note.
func (r *Repo) SetStarred(ctx context.Context, id, userID int64, starred bool) error {
	return r.setBool(ctx, "starred", id, userID, starred)
}

// SetPinned toggles the pinned flag for a note.
func (r *Repo) SetPinned(ctx context.Context, id, userID int64, pinned bool) error {
	return r.setBool(ctx, "pinned", id, userID, pinned)
}

func (r *Repo) setBool(ctx context.Context, col string, id, userID int64, val bool) error {
	v := 0
	if val {
		v = 1
	}
	res, err := r.db.ExecContext(ctx,
		fmt.Sprintf(`UPDATE notes SET %s=? WHERE id=? AND user_id=?`, col),
		v, id, userID,
	)
	if err != nil {
		return fmt.Errorf("set %s: %w", col, err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// SoftDelete moves a note to the trash table.
// Subsequent Get/List calls will exclude trashed notes.
func (r *Repo) SoftDelete(ctx context.Context, id, userID int64) error {
	// Verify ownership first.
	var exists int
	if err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM notes WHERE id=? AND user_id=?`, id, userID,
	).Scan(&exists); err != nil {
		return fmt.Errorf("soft delete check: %w", err)
	}
	if exists == 0 {
		return ErrNotFound
	}

	_, err := r.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO trash(note_id, user_id) VALUES(?, ?)`, id, userID,
	)
	return err
}

// Archive moves a note to the archive (hidden from normal list but not deleted).
func (r *Repo) Archive(ctx context.Context, id, userID int64) error {
	return r.setBool(ctx, "archived", id, userID, true)
}

// Unarchive restores an archived note back to the normal list.
func (r *Repo) Unarchive(ctx context.Context, id, userID int64) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE notes SET archived=0 WHERE id=? AND user_id=?`, id, userID,
	)
	if err != nil {
		return fmt.Errorf("unarchive: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// ListArchived returns archived, non-trashed notes for a user ordered by
// updated_at DESC. limit <= 0 disables pagination (only used in trusted
// contexts such as full exports).
func (r *Repo) ListArchived(ctx context.Context, userID int64, limit, offset int) ([]*Note, error) {
	query := `
		SELECT n.id, n.user_id, n.title, n.body, n.starred, n.pinned, n.archived,
		       n.created_at, n.updated_at
		FROM notes n
		WHERE n.user_id = ?
		  AND n.archived = 1
		  AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.note_id = n.id)
		ORDER BY n.updated_at DESC`
	args := []any{userID}
	if limit > 0 {
		query += ` LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	}
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list archived: %w", err)
	}
	defer rows.Close()

	var result []*Note
	for rows.Next() {
		n := &Note{}
		var starred, pinned, archived int
		if err := rows.Scan(
			&n.ID, &n.UserID, &n.Title, &n.Body,
			&starred, &pinned, &archived, &n.CreatedAt, &n.UpdatedAt,
		); err != nil {
			return nil, err
		}
		n.Starred = starred != 0
		n.Pinned = pinned != 0
		n.Archived = archived != 0
		result = append(result, n)
	}
	return result, rows.Err()
}

// HardDelete permanently removes a note and its trash record.
func (r *Repo) HardDelete(ctx context.Context, id, userID int64) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM notes WHERE id=? AND user_id=?`, id, userID,
	)
	if err != nil {
		return fmt.Errorf("hard delete: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}
