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

// AddToNote associates a tag with a note. Ownership and MCP visibility are
// checked in the write itself: a privacy change must not race a prior SELECT.
func (r *Repo) AddToNote(ctx context.Context, noteID, tagID, userID int64) error {
	query := `INSERT INTO note_tags(note_id, tag_id)
		SELECT n.id, t.id FROM notes n JOIN tags t ON t.user_id=n.user_id
		WHERE n.id=? AND t.id=? AND n.user_id=?` + privateNoteClause(ctx)
	if requestctx.IsMCP(ctx) {
		// A guessed private-only tag must not become visible by attaching it
		// to a public note. Its visibility can change concurrently too.
		query += ` AND (NOT EXISTS (SELECT 1 FROM note_tags a WHERE a.tag_id=t.id)
			OR EXISTS (SELECT 1 FROM note_tags a JOIN notes linked ON linked.id=a.note_id
			           WHERE a.tag_id=t.id AND linked.private=0))`
	}
	// A duplicate association remains a successful, idempotent request. The
	// no-op update distinguishes an authorized duplicate (one affected row)
	// from a missing/invisible note or tag (zero rows), without a stale check.
	query += ` ON CONFLICT(note_id, tag_id) DO UPDATE SET tag_id=excluded.tag_id`
	res, err := r.db.ExecContext(ctx, query, noteID, tagID, userID)
	if err != nil {
		return fmt.Errorf("add tag to note: %w", err)
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

// RemoveFromNote removes a tag association, enforcing ownership and privacy
// within the DELETE so a concurrent privacy change cannot invalidate the gate.
func (r *Repo) RemoveFromNote(ctx context.Context, noteID, tagID, userID int64) error {
	query := `DELETE FROM note_tags WHERE note_id=? AND tag_id=?
		AND EXISTS (SELECT 1 FROM notes n WHERE n.id=note_tags.note_id AND n.user_id=?` + privateNoteClause(ctx) + `)`
	res, err := r.db.ExecContext(ctx, query, noteID, tagID, userID)
	if err != nil {
		return fmt.Errorf("remove tag from note: %w", err)
	}
	count, err := res.RowsAffected()
	if err != nil || count > 0 {
		return err
	}
	// Preserve idempotent removal of an absent association on a visible owned
	// note. This read classifies a no-op only; no write follows it.
	var exists int
	err = r.db.QueryRowContext(ctx,
		`SELECT 1 FROM notes n WHERE n.id=? AND n.user_id=?`+privateNoteClause(ctx), noteID, userID,
	).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
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
