package images

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// OrphanGracePeriod is how long an uploaded image is kept before it becomes
// eligible for reaping when no note references it. It has to comfortably
// outlast the gap between an upload and the save of the note that embeds it:
// an extension clip can spend a couple of minutes uploading images, and an
// editor paste may sit in an unsaved note for as long as the tab stays open.
// 24 hours covers a forgotten-but-still-open tab while still bounding how long
// a genuine orphan occupies a user's quota.
const OrphanGracePeriod = 24 * time.Hour

// SweepOrphanBatch is the default number of images deleted per sweep pass.
// SQLite is single-writer with a single pooled connection, so the number of
// writes a pass performs is capped to keep it from stalling other requests.
const SweepOrphanBatch = 500

// deleteChunk caps how many ids go into one DELETE statement.
const deleteChunk = 100

// imageAPIPath matches the /api/images/<id> URLs that note bodies use to
// reference an upload. Mirrors the scan in internal/export.
var imageAPIPath = regexp.MustCompile(`/api/images/([A-Za-z0-9_.-]+)`)

// SweepOrphans deletes up to limit images that are older than grace and that
// no note body of the owning user references. Notes that are archived or in
// trash still count as references, so their images survive. It returns the
// number of images deleted.
//
// Each affected user's notes are read exactly once per pass and their
// referenced ids struck off the candidate set, rather than the notes table
// being rescanned per candidate image — so a pass stays linear in the size of
// the two tables instead of quadratic. limit caps deletions rather than
// candidates, so a run of older, still-referenced images cannot starve a
// newer orphan out of every pass.
func SweepOrphans(ctx context.Context, db *sql.DB, grace time.Duration, limit int) (int, error) {
	if limit <= 0 {
		limit = SweepOrphanBatch
	}
	cutoff := time.Now().Add(-grace).UTC()

	userIDs, err := usersWithAgedImages(ctx, db, cutoff)
	if err != nil {
		return 0, err
	}

	deleted := 0
	for _, userID := range userIDs {
		if deleted >= limit {
			break
		}
		ids, err := agedImageIDs(ctx, db, userID, cutoff)
		if err != nil {
			return deleted, err
		}
		orphans, err := unreferenced(ctx, db, userID, ids)
		if err != nil {
			return deleted, err
		}
		if len(orphans) > limit-deleted {
			orphans = orphans[:limit-deleted]
		}
		n, err := deleteImages(ctx, db, userID, orphans)
		deleted += n
		if err != nil {
			return deleted, err
		}
	}
	return deleted, nil
}

// usersWithAgedImages lists the users holding at least one image old enough to
// be considered for reaping.
func usersWithAgedImages(ctx context.Context, db *sql.DB, cutoff time.Time) ([]int64, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT DISTINCT user_id FROM images WHERE created_at < ?`, cutoff)
	if err != nil {
		return nil, fmt.Errorf("sweep list users: %w", err)
	}
	defer rows.Close()

	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("sweep list users: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// agedImageIDs returns userID's images created before cutoff, oldest first.
func agedImageIDs(ctx context.Context, db *sql.DB, userID int64, cutoff time.Time) ([]string, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id FROM images WHERE user_id = ? AND created_at < ? ORDER BY created_at`,
		userID, cutoff)
	if err != nil {
		return nil, fmt.Errorf("sweep candidate images: %w", err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("sweep candidate images: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// unreferenced returns the subset of ids that none of userID's note bodies
// mention, preserving order. Only that user's notes are read, so one user's
// notes can never keep — or condemn — another user's image.
func unreferenced(ctx context.Context, db *sql.DB, userID int64, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	pending := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		pending[id] = struct{}{}
	}

	rows, err := db.QueryContext(ctx, `SELECT body FROM notes WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("sweep scan notes: %w", err)
	}
	defer rows.Close()

	for rows.Next() && len(pending) > 0 {
		var body string
		if err := rows.Scan(&body); err != nil {
			return nil, fmt.Errorf("sweep scan notes: %w", err)
		}
		if !strings.Contains(body, "/api/images/") {
			continue
		}
		for _, m := range imageAPIPath.FindAllStringSubmatch(body, -1) {
			delete(pending, m[1])
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sweep scan notes: %w", err)
	}

	out := make([]string, 0, len(pending))
	for _, id := range ids {
		if _, ok := pending[id]; ok {
			out = append(out, id)
		}
	}
	return out, nil
}

// deleteImages removes the given image ids, in chunks so that no single
// statement holds the write lock for long. The user_id predicate keeps the
// delete scoped to its owner.
func deleteImages(ctx context.Context, db *sql.DB, userID int64, ids []string) (int, error) {
	deleted := 0
	for len(ids) > 0 {
		chunk := ids
		if len(chunk) > deleteChunk {
			chunk = chunk[:deleteChunk]
		}
		ids = ids[len(chunk):]

		args := make([]any, 0, len(chunk)+1)
		args = append(args, userID)
		for _, id := range chunk {
			args = append(args, id)
		}
		query := fmt.Sprintf(
			`DELETE FROM images WHERE user_id = ? AND id IN (?%s)`,
			strings.Repeat(",?", len(chunk)-1),
		)
		res, err := db.ExecContext(ctx, query, args...)
		if err != nil {
			return deleted, fmt.Errorf("sweep delete images: %w", err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return deleted, err
		}
		deleted += int(n)
	}
	return deleted, nil
}
