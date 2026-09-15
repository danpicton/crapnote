package tags

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/danpicton/crapnote/internal/db"
	"github.com/danpicton/crapnote/internal/requestctx"
)

// Repo provides access to the tags and note_tags tables.
type Repo struct {
	db *db.DB
}

func noPrivateAssociations(ctx context.Context, alias string) string {
	if requestctx.IsMCP(ctx) {
		return " AND NOT EXISTS (SELECT 1 FROM note_tags a JOIN notes n ON n.id=a.note_id WHERE a.tag_id=" + alias + ".id AND n.private=1)"
	}
	return ""
}

func privateNoteClause(ctx context.Context) string {
	if requestctx.IsMCP(ctx) {
		return " AND n.private=0"
	}
	return ""
}

// NewRepo creates a new tags Repo.
func NewRepo(database *db.DB) *Repo {
	return &Repo{db: database}
}

// Create inserts a new tag for the given user.
func (r *Repo) Create(ctx context.Context, userID int64, name string) (*Tag, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO tags(user_id, name) VALUES(?, ?)`, userID, name,
	)
	if err != nil {
		return nil, fmt.Errorf("create tag: %w", err)
	}
	id, _ := res.LastInsertId()
	return r.FindByID(ctx, id, userID)
}

// List returns tags for a user with their note counts. limit <= 0 disables
// pagination; otherwise LIMIT/OFFSET are applied to keep list responses
// bounded.
func (r *Repo) List(ctx context.Context, userID int64, limit, offset int) ([]*TagWithCount, error) {
	query := `
		SELECT t.id, t.user_id, t.name, t.created_at,
		       COUNT(nt.note_id) AS note_count
		FROM tags t
		LEFT JOIN note_tags nt ON nt.tag_id = t.id
		WHERE t.user_id = ?
		GROUP BY t.id
		ORDER BY t.name`
	args := []any{userID}
	if requestctx.IsMCP(ctx) {
		query = `
			SELECT t.id, t.user_id, t.name, t.created_at, COUNT(nt.note_id)
			FROM tags t
			LEFT JOIN note_tags nt ON nt.tag_id=t.id
			  AND EXISTS (SELECT 1 FROM notes n WHERE n.id=nt.note_id AND n.private=0)
			WHERE t.user_id=?
			  AND (NOT EXISTS (SELECT 1 FROM note_tags a WHERE a.tag_id=t.id)
			       OR EXISTS (SELECT 1 FROM note_tags a JOIN notes n ON n.id=a.note_id WHERE a.tag_id=t.id AND n.private=0))
			GROUP BY t.id ORDER BY t.name`
	}
	if limit > 0 {
		query += ` LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	}
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list tags: %w", err)
	}
	defer rows.Close()

	var result []*TagWithCount
	for rows.Next() {
		twc := &TagWithCount{}
		if err := rows.Scan(
			&twc.ID, &twc.UserID, &twc.Name, &twc.CreatedAt, &twc.NoteCount,
		); err != nil {
			return nil, err
		}
		result = append(result, twc)
	}
	return result, rows.Err()
}

// FindByID returns the tag with the given ID for the given user.
func (r *Repo) FindByID(ctx context.Context, id, userID int64) (*Tag, error) {
	t := &Tag{}
	err := r.db.QueryRowContext(ctx,
		`SELECT id, user_id, name, created_at FROM tags WHERE id=? AND user_id=?`,
		id, userID,
	).Scan(&t.ID, &t.UserID, &t.Name, &t.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find tag: %w", err)
	}
	return t, nil
}

// Rename updates the name of a tag. Returns ErrNotFound if not owned by user.
func (r *Repo) Rename(ctx context.Context, id, userID int64, name string) (*Tag, error) {
	query := `UPDATE tags SET name=? WHERE id=? AND user_id=?` + noPrivateAssociations(ctx, "tags")
	res, err := r.db.ExecContext(ctx, query, name, id, userID)
	if err != nil {
		return nil, fmt.Errorf("rename tag: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return r.FindByID(ctx, id, userID)
}

// Delete removes a tag and all its note_tags associations (cascade via FK).
func (r *Repo) Delete(ctx context.Context, id, userID int64) error {
	query := `DELETE FROM tags WHERE id=? AND user_id=?` + noPrivateAssociations(ctx, "tags")
	res, err := r.db.ExecContext(ctx, query, id, userID)
	if err != nil {
		return fmt.Errorf("delete tag: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AddToNote associates a tag with a note, verifying both belong to userID.
func (r *Repo) AddToNote(ctx context.Context, noteID, tagID, userID int64) error {
	// Verify the note belongs to the user and is visible to this origin.
	var noteOwner int64
	query := `SELECT user_id FROM notes WHERE id=?`
	if requestctx.IsMCP(ctx) {
		query += ` AND private=0`
	}
	if err := r.db.QueryRowContext(ctx, query, noteID).Scan(&noteOwner); errors.Is(err, sql.ErrNoRows) || noteOwner != userID {
		return ErrNotFound
	}

	// Verify the tag belongs to the user and does not disclose a private-only
	// association to MCP callers that guessed its ID.
	if requestctx.IsMCP(ctx) {
		var visible int
		err := r.db.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM tags t
			WHERE t.id=? AND t.user_id=?
			  AND (NOT EXISTS (SELECT 1 FROM note_tags a WHERE a.tag_id=t.id)
			       OR EXISTS (SELECT 1 FROM note_tags a JOIN notes n ON n.id=a.note_id
			                  WHERE a.tag_id=t.id AND n.private=0))`, tagID, userID).Scan(&visible)
		if err != nil {
			return err
		}
		if visible == 0 {
			return ErrNotFound
		}
	} else if _, err := r.FindByID(ctx, tagID, userID); err != nil {
		return err
	}

	_, err := r.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO note_tags(note_id, tag_id) VALUES(?, ?)`, noteID, tagID,
	)
	return err
}

// RemoveFromNote removes a tag association from a note.
func (r *Repo) RemoveFromNote(ctx context.Context, noteID, tagID, userID int64) error {
	// Verify note ownership and visibility to this origin.
	var noteOwner int64
	query := `SELECT user_id FROM notes WHERE id=?`
	if requestctx.IsMCP(ctx) {
		query += ` AND private=0`
	}
	if err := r.db.QueryRowContext(ctx, query, noteID).Scan(&noteOwner); errors.Is(err, sql.ErrNoRows) || noteOwner != userID {
		return ErrNotFound
	}

	_, err := r.db.ExecContext(ctx,
		`DELETE FROM note_tags WHERE note_id=? AND tag_id=?`, noteID, tagID,
	)
	return err
}

// ListForNote returns all tags applied to a given note for the given user.
func (r *Repo) ListForNote(ctx context.Context, noteID, userID int64) ([]*Tag, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT t.id, t.user_id, t.name, t.created_at
		FROM tags t
		JOIN note_tags nt ON nt.tag_id = t.id
		JOIN notes n      ON n.id       = nt.note_id
		WHERE nt.note_id = ? AND n.user_id = ?`+privateNoteClause(ctx)+`
		ORDER BY t.name
	`, noteID, userID)
	if err != nil {
		return nil, fmt.Errorf("list tags for note: %w", err)
	}
	defer rows.Close()

	var result []*Tag
	for rows.Next() {
		tg := &Tag{}
		if err := rows.Scan(&tg.ID, &tg.UserID, &tg.Name, &tg.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, tg)
	}
	return result, rows.Err()
}
