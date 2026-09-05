package images

import (
	"context"
	"database/sql"
	"fmt"
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
// SQLite is single-writer, so the work is bounded to keep the write lock short.
const SweepOrphanBatch = 500

// SweepOrphans deletes up to limit images that are older than grace and that
// no note body of the owning user references. Notes that are archived or in
// trash still count as references, so their images survive. It returns the
// number of images deleted.
func SweepOrphans(ctx context.Context, db *sql.DB, grace time.Duration, limit int) (int, error) {
	if limit <= 0 {
		limit = SweepOrphanBatch
	}
	cutoff := time.Now().Add(-grace).UTC()

	res, err := db.ExecContext(ctx, `
		DELETE FROM images
		WHERE id IN (
			SELECT i.id FROM images i
			WHERE i.created_at < ?
			  AND NOT EXISTS (
				SELECT 1 FROM notes n
				WHERE n.user_id = i.user_id
				  AND n.body LIKE '%/api/images/' || i.id || '%'
			  )
			LIMIT ?
		)`, cutoff, limit)
	if err != nil {
		return 0, fmt.Errorf("sweep orphan images: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	return int(n), nil
}
