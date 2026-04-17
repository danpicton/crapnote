# Deployment security hardening

Operational guidance that lives outside the application itself. These mitigations
address threats that cannot be handled at the application layer alone.

## 1. Disk / volume encryption (issue #24)

CrapNote stores note content, images (as BLOBs in SQLite), and session tokens
in a single database file. The primary at-rest threat is an attacker who
obtains a copy of that file — a stolen backup, a compromised storage volume, or
unauthorised access to the hosting provider's infrastructure.

**The application does not (and should not) encrypt its own data.** See issue
#24 for the rationale: application-level encryption destroys full-text search
and introduces difficult key management, while the problem it solves is
addressed more simply at the OS/volume layer.

Choose an encryption option appropriate to your deployment:

- **LUKS** on the partition that holds `DATABASE_PATH` (bare metal / VM).
- **Docker volume encryption** — mount an already-encrypted host volume
  into the container rather than using a plain bind mount.
- **Encrypted EBS / persistent disk** on AWS / GCP / Azure. All three
  providers now enable this by default for new volumes.
- **Kubernetes**: set `storageClassName` on the PVC in `deploy/k8s/pvc.yaml`
  to a class backed by an encrypted disk type.

With volume encryption in place the SQLite file at `DATABASE_PATH` and any
PostgreSQL data directory are transparently protected against offline theft.
FTS5 continues to work; no application changes are required.

## 2. PostgreSQL Row Level Security (issue #23)

CrapNote supports PostgreSQL as an optional backend. Every application query
already filters by `user_id`, so RLS is strictly a defence-in-depth mitigation:
it guarantees that a bug in any current or future query cannot leak rows
between users.

A ready-to-apply script is in `deploy/postgres/rls.sql`. It:

1. Enables RLS on every user-scoped table.
2. Creates policies keyed on a per-connection GUC (`app.current_user_id`).
3. Uses a helper function that fails closed when the GUC is unset.

Before enabling RLS, the following application-layer changes are required —
otherwise the running app will see zero rows:

1. **Propagate the authenticated user ID through the connection**:
   on each request, run `SET LOCAL app.current_user_id = $1` inside a
   transaction, or set it on connection pickup if using session-mode pooling.
2. **Run the application as a non-superuser role** (see the header of
   `rls.sql`). Superusers bypass RLS silently, which defeats the point.
3. **Handle admin endpoints**: `/api/admin/users` intentionally reads across
   users. Either route admin queries through a role with `BYPASSRLS`, or add
   policies that permit admins via a separate GUC.
4. **Use session-mode pooling** if using PgBouncer. Transaction-mode pooling
   discards session state and breaks RLS.

Because of these prerequisites, RLS is not enabled automatically by a
migration. It is an operator decision, appropriate for multi-user deployments
where the additional safety net justifies the connection-layer plumbing.

## 3. Other mitigations already in the app

The following are enforced in code and do not need operator configuration:

- **Login rate limiting** — per-IP token bucket on `POST /api/auth/login`
  (issue #12). Trip threshold can be tuned via the limiter in
  `cmd/server/main.go`.
- **Image upload throttling** — per-user rate limit and storage quota
  (issue #15). Tunable via `IMAGE_UPLOADS_PER_MINUTE` and `IMAGE_QUOTA_MB`
  environment variables.
- **Pagination** — all list endpoints enforce a maximum page size
  (issue #18). Max is 100 items per request.
