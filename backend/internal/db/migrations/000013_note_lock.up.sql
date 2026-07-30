-- Locked notes are read-only: edits and deletes are rejected until the note is
-- unlocked. A daily background job also locks notes whose content has not been
-- updated for a configured number of days.
ALTER TABLE notes ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_notes_locked ON notes(user_id, locked);
