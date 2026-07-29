DROP INDEX IF EXISTS idx_notes_locked;
ALTER TABLE notes DROP COLUMN locked;
