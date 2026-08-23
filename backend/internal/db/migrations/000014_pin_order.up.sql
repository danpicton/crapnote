-- Pinned notes keep a user-chosen order, set by dragging them in the list.
-- Unpinned notes always carry 0 so the List ordering falls through to
-- updated_at for them; SetPinned resets the column on unpin to preserve that.
ALTER TABLE notes ADD COLUMN pin_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_notes_pin_order ON notes(user_id, pin_order);
