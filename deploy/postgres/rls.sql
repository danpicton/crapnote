-- Row Level Security (RLS) policies for CrapNote (issue #23).
--
-- This script is OPTIONAL defence-in-depth for multi-user PostgreSQL
-- deployments. CrapNote's application code already scopes every query by
-- user_id, so RLS is belt-and-braces: it guarantees at the database level
-- that a bug in any future query cannot leak one user's rows to another.
--
-- ────────────────────────────────────────────────────────────────────────
-- How it works
-- ────────────────────────────────────────────────────────────────────────
-- Each connection advertises its authenticated user via a custom GUC
-- (app.current_user_id). Policies on every user-scoped table restrict
-- SELECT/INSERT/UPDATE/DELETE to rows where user_id matches the GUC.
--
-- The application layer must set the GUC at the start of each request:
--
--    SET LOCAL app.current_user_id = $1   -- inside a transaction
--
-- …or use a pooled connection in session-mode pooling (PgBouncer with
-- pool_mode = session) and set the value on connection pickup. Transaction
-- pooling (pool_mode = transaction) drops session state and will break RLS.
--
-- ────────────────────────────────────────────────────────────────────────
-- Application role
-- ────────────────────────────────────────────────────────────────────────
-- Run the application as a dedicated role that does NOT have BYPASSRLS.
-- The superuser / owner role retains full access for migrations and for
-- admin endpoints that intentionally read across users.
--
--   CREATE ROLE crapnote_app LOGIN PASSWORD '…';
--   GRANT USAGE ON SCHEMA public TO crapnote_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--     TO crapnote_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crapnote_app;
--
-- Admin endpoints (e.g. GET /api/admin/users) must use a separate
-- connection pool that runs as a role with BYPASSRLS, or the policies
-- below must explicitly include a bypass for admin users.
-- ────────────────────────────────────────────────────────────────────────

BEGIN;

-- Enable RLS on every user-scoped table.
ALTER TABLE notes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_tags  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE images     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trash      ENABLE ROW LEVEL SECURITY;

-- Helper: current_user_id() returns NULL when the GUC is unset so policies
-- fail closed rather than matching user_id = 0 by accident.
CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS BIGINT
LANGUAGE plpgsql STABLE
AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_user_id', true), '')::bigint;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

-- Policies: match on user_id for tables that carry one directly.
CREATE POLICY notes_isolation    ON notes    USING (user_id = app_current_user_id());
CREATE POLICY tags_isolation     ON tags     USING (user_id = app_current_user_id());
CREATE POLICY sessions_isolation ON sessions USING (user_id = app_current_user_id());
CREATE POLICY images_isolation   ON images   USING (user_id = app_current_user_id());
CREATE POLICY trash_isolation    ON trash    USING (user_id = app_current_user_id());

-- note_tags has no user_id column — derive ownership through the parent note.
CREATE POLICY note_tags_isolation ON note_tags
USING (
    EXISTS (
        SELECT 1 FROM notes n
        WHERE n.id = note_tags.note_id
          AND n.user_id = app_current_user_id()
    )
);

COMMIT;
