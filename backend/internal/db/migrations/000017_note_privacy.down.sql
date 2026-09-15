DROP INDEX IF EXISTS idx_notes_user_private;
ALTER TABLE notes DROP COLUMN private;
