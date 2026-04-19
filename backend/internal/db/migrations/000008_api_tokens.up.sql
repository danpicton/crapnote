ALTER TABLE users ADD COLUMN api_tokens_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS api_tokens (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    token_hash    TEXT    NOT NULL UNIQUE,
    prefix        TEXT    NOT NULL,
    scope         TEXT    NOT NULL,
    last_used_at  DATETIME,
    expires_at    DATETIME,
    revoked_at    DATETIME,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
