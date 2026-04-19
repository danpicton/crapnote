DROP INDEX IF EXISTS idx_api_tokens_token_hash;
DROP INDEX IF EXISTS idx_api_tokens_user_id;
DROP TABLE IF EXISTS api_tokens;

ALTER TABLE users DROP COLUMN api_tokens_enabled;
