-- Since #109 the failed-login counter lives in an in-memory (client IP,
-- username) tracker; nothing has written this column since. Dropping it
-- removes a live-looking accessor for state no code path maintains. Any
-- stale non-zero count was already inert — only locked_at/locked_until
-- decide whether an account is locked.
ALTER TABLE users DROP COLUMN failed_login_attempts;
