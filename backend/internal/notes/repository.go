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
	var starred, pinned, archived, locked int
	err := r.db.QueryRowContext(ctx, `
		SELECT n.id, n.user_id, n.title, n.body, n.starred, n.pinned, n.archived, n.locked,
		       n.pin_order, n.created_at, n.updated_at
		FROM notes n
		WHERE n.id = ? AND n.user_id = ?
		  AND n.archived = 0
		  AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.note_id = n.id)
	`, id, userID).Scan(
		&n.ID, &n.UserID, &n.Title, &n.Body,
		&starred, &pinned, &archived, &locked, &n.PinOrder, &n.CreatedAt, &n.UpdatedAt,
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
	n.Locked = locked != 0
	return n, nil
}

// IsLocked reports whether a note is locked. Returns ErrNotFound if the note
// does not exist or belongs to a different user. Unlike Get it also considers
// archived and trashed notes, so content operations on those still respect the
// lock.
func (r *Repo) IsLocked(ctx context.Context, id, userID int64) (bool, error) {
	var locked int
	err := r.db.QueryRowContext(ctx,
		`SELECT locked FROM notes WHERE id = ? AND user_id = ?`, id, userID,
	).Scan(&locked)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, fmt.Errorf("is locked: %w", err)
	}
	return locked != 0, nil
}

// List returns all non-trashed notes for a user, with optional filters.
// Pinned notes appear first in their user-chosen order, then the rest by
// updated_at DESC.
func (r *Repo) List(ctx context.Context, userID int64, filter ListFilter) ([]*Note, error) {
	query := `
		SELECT n.id, n.user_id, n.title, n.body, n.starred, n.pinned, n.archived, n.locked,
		       n.pin_order, n.created_at, n.updated_at
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

	// pin_order is the user's drag order among pinned notes. It is always 0
	// for unpinned notes, so for those this collapses to updated_at DESC.
	query += ` ORDER BY n.pinned DESC, n.pin_order ASC, n.updated_at DESC`

	if filter.Limit > 0 {
		query += ` LIMIT ? OFFSET ?`
		args = append(args, filter.Limit, filter.Offset)
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	defer rows.Close()

	return scanNotes(rows)
}

// Update performs a partial update of a note's title and/or body. Only non-nil
// fields are written; the other field keeps its current value.
// Returns ErrNotFound if the note does not exist or belongs to a different user,
// and ErrLocked if it is locked.
//
// The locked check lives in the UPDATE's own WHERE clause rather than in a
// preceding SELECT, so a concurrent SetLocked or AutoLockStale cannot slip in
// between the check and the write.
func (r *Repo) Update(ctx context.Context, id, userID int64, title, body *string) (*Note, error) {
	now := time.Now().UTC()
	res, err := r.db.ExecContext(ctx, `
		UPDATE notes
		SET title      = CASE WHEN ? IS NOT NULL THEN ? ELSE title END,
		    body       = CASE WHEN ? IS NOT NULL THEN ? ELSE body  END,
		    updated_at = ?
		WHERE id = ? AND user_id = ? AND archived = 0 AND locked = 0`,
		title, title, body, body, now, id, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("update note: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		// Zero rows means missing, another user's, or locked — ask which.
		// IsLocked reports ErrNotFound for the first two.
		locked, err := r.IsLocked(ctx, id, userID)
		if err != nil {
			return nil, err
		}
		if locked {
			return nil, ErrLocked
		}
		return nil, ErrNotFound
	}
	return r.Get(ctx, id, userID)
}

// scanNotes drains a rows set selecting the standard note column list.
func scanNotes(rows *sql.Rows) ([]*Note, error) {
	var result []*Note
	for rows.Next() {
		n := &Note{}
		var starred, pinned, archived, locked int
		if err := rows.Scan(
			&n.ID, &n.UserID, &n.Title, &n.Body,
			&starred, &pinned, &archived, &locked, &n.PinOrder, &n.CreatedAt, &n.UpdatedAt,
		); err != nil {
			return nil, err
		}
		n.Starred = starred != 0
		n.Pinned = pinned != 0
		n.Archived = archived != 0
		n.Locked = locked != 0
		result = append(result, n)
	}
	return result, rows.Err()
}

// SetStarred toggles the starred flag for a note.
func (r *Repo) SetStarred(ctx context.Context, id, userID int64, starred bool) error {
	return r.setBool(ctx, "starred", id, userID, starred)
}

// SetLocked sets the locked flag for a note.
func (r *Repo) SetLocked(ctx context.Context, id, userID int64, locked bool) error {
	return r.setBool(ctx, "locked", id, userID, locked)
}

// AutoLockStale locks every unlocked, untrashed note whose content has not been
// updated within the given window, and reports how many notes it locked.
//
// It deliberately writes only the locked column: updated_at is the signal this
// job reads, so touching it would make each run reset the staleness clock.
func (r *Repo) AutoLockStale(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().UTC().Add(-olderThan)
	res, err := r.db.ExecContext(ctx, `
		UPDATE notes
		SET locked = 1
		WHERE locked = 0
		  AND updated_at < ?
		  AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.note_id = notes.id)`,
		cutoff,
	)
	if err != nil {
		return 0, fmt.Errorf("auto-lock stale notes: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("auto-lock rows affected: %w", err)
	}
	return n, nil
}

// SetPinned toggles the pinned flag for a note.
//
// Pinning also claims the top slot, which is where a freshly pinned note has
// always appeared; unpinning resets the slot to 0 so the note sorts purely by
// updated_at among the unpinned ones. Neither touches updated_at — pinning is
// not a content edit.
func (r *Repo) SetPinned(ctx context.Context, id, userID int64, pinned bool) error {
	var res sql.Result
	var err error
	if pinned {
		res, err = r.db.ExecContext(ctx, `
			UPDATE notes
			SET pinned = 1,
			    pin_order = COALESCE(
			        (SELECT MIN(p.pin_order) - 1 FROM notes p
			          WHERE p.user_id = ? AND p.pinned = 1 AND p.id <> notes.id),
			        0)
			WHERE id = ? AND user_id = ?`,
			userID, id, userID,
		)
	} else {
		res, err = r.db.ExecContext(ctx,
			`UPDATE notes SET pinned = 0, pin_order = 0 WHERE id = ? AND user_id = ?`,
			id, userID,
		)
	}
	if err != nil {
		return fmt.Errorf("set pinned: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// ReorderPins writes an explicit order over the user's pinned notes, given
// their IDs top-first.
//
// The whole pinned set is renumbered, not just the IDs passed in: the named
// ones take the top slots in the order given, and any pinned note the caller
// did not mention keeps its relative position below them. A filtered list view
// can only ever send the pinned notes it can see, and renumbering just those
// would collide with the positions held by the ones outside the filter —
// scrambling an order the user never touched.
//
// IDs that aren't the caller's, or aren't currently pinned, are skipped rather
// than rejected: the client sends the order it just rendered, and a note
// unpinned on another device shouldn't fail the whole request. Like SetPinned
// this leaves updated_at alone.
func (r *Repo) ReorderPins(ctx context.Context, userID int64, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("reorder pins: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	current, err := pinnedIDs(ctx, tx, userID)
	if err != nil {
		return err
	}
	if len(current) == 0 {
		return tx.Commit()
	}

	final := mergePinOrder(current, ids)

	stmt, err := tx.PrepareContext(ctx,
		`UPDATE notes SET pin_order = ? WHERE id = ? AND user_id = ? AND pinned = 1`)
	if err != nil {
		return fmt.Errorf("reorder pins: %w", err)
	}
	defer stmt.Close() //nolint:errcheck

	for i, id := range final {
		if _, err := stmt.ExecContext(ctx, i, id, userID); err != nil {
			return fmt.Errorf("reorder pins: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("reorder pins: %w", err)
	}
	return nil
}

// pinnedIDs lists the user's pinned note IDs in their current display order.
func pinnedIDs(ctx context.Context, tx *sql.Tx, userID int64) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id FROM notes
		WHERE user_id = ? AND pinned = 1
		  AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.note_id = notes.id)
		ORDER BY pin_order ASC, updated_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("reorder pins: %w", err)
	}
	defer rows.Close()

	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("reorder pins: %w", err)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reorder pins: %w", err)
	}
	return out, nil
}

// mergePinOrder puts the requested IDs first, in the order asked for, and the
// remaining pinned IDs after them in their existing order. Requested IDs that
// aren't pinned (or aren't the caller's) drop out, and duplicates are ignored.
func mergePinOrder(current, requested []int64) []int64 {
	pinned := make(map[int64]bool, len(current))
	for _, id := range current {
		pinned[id] = true
	}

	final := make([]int64, 0, len(current))
	placed := make(map[int64]bool, len(current))
	for _, id := range requested {
		if !pinned[id] || placed[id] {
			continue
		}
		placed[id] = true
		final = append(final, id)
	}
	for _, id := range current {
		if !placed[id] {
			final = append(final, id)
		}
	}
	return final
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
	// Ownership and the locked check are part of the insert itself, so a
	// concurrent SetLocked or AutoLockStale cannot land between them and the
	// write.
	res, err := r.db.ExecContext(ctx, `
		INSERT OR IGNORE INTO trash(note_id, user_id)
		SELECT id, user_id FROM notes
		WHERE id = ? AND user_id = ? AND locked = 0`, id, userID,
	)
	if err != nil {
		return fmt.Errorf("soft delete: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		// IsLocked reports ErrNotFound for a missing or another user's note.
		locked, err := r.IsLocked(ctx, id, userID)
		if err != nil {
			return err
		}
		if locked {
			return ErrLocked
		}
		// The note exists and is unlocked, so OR IGNORE swallowed the insert:
		// it is already in the trash, which stays a no-op.
		return nil
	}
	return nil
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
		SELECT n.id, n.user_id, n.title, n.body, n.starred, n.pinned, n.archived, n.locked,
		       n.pin_order, n.created_at, n.updated_at
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

	return scanNotes(rows)
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
