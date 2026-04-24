CREATE TABLE IF NOT EXISTS user_invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT    NOT NULL UNIQUE,
    expires_at  DATETIME NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_invites_user_id ON user_invites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_invites_token_hash ON user_invites(token_hash);
