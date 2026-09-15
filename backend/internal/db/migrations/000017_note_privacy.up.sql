ALTER TABLE notes ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_notes_user_private ON notes(user_id, private);
