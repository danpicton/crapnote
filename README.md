# CrapNote

A full-stack progressive web app (PWA) notes application.

| Layer | Technology |
|---|---|
| Frontend | Svelte 5 (SvelteKit), Vitest |
| Backend | Go 1.24, `net/http` stdlib router |
| Database | SQLite (default) or PostgreSQL (via `DATABASE_URL`) |
| Deployment | Single Docker container; Go binary with Svelte output embedded via `go:embed` |

---

## Project structure

```
/
├── backend/
│   ├── cmd/server/          # main entrypoint + HTTP mux
│   ├── internal/
│   │   ├── auth/            # users, sessions, login/logout handlers, middleware
│   │   ├── db/              # Open(), embedded migration runner
│   │   │   └── migrations/  # versioned *.up.sql / *.down.sql files
│   │   ├── notes/           # (next)
│   │   ├── tags/
│   │   ├── trash/
│   │   ├── export/
│   │   └── search/
│   ├── static/              # go:embed target — populated from frontend build
│   ├── go.mod
│   └── Makefile
├── frontend/                # SvelteKit app
├── deploy/
│   ├── docker-compose.yml
│   └── k8s/                 # Kubernetes manifests (Traefik IngressRoute)
└── Dockerfile               # multi-stage: node → go (CGO) → distroless/cc
```

---

## Prerequisites

- Go 1.24 (`go version`)
- gcc / build-essential (required for `mattn/go-sqlite3` CGO)
- Node 18+ / npm
- SQLite development headers (`libsqlite3-dev`) — only needed if building from scratch; the bundled amalgamation is used at link time

---

## Running the backend

```bash
cd backend

# Run (dev)
make run
# or: GOTOOLCHAIN=local CGO_ENABLED=1 go run -tags sqlite_fts5 ./cmd/server

# Build binary
make build          # outputs ./server

# Run all tests
make test           # GOTOOLCHAIN=local go test -tags sqlite_fts5 ./...
```

### Critical build constraints

| Constraint | Why |
|---|---|
| `-tags sqlite_fts5` | Enables FTS5 full-text search in the bundled SQLite. Without it migrations fail at the `notes_fts` virtual table step. |
| `GOTOOLCHAIN=local` | `golang.org/x/crypto` is pinned at v0.36.0 (the latest version compatible with Go 1.24). Without this flag `go mod tidy` tries to upgrade to a version that requires Go 1.25+ and then attempts to download a new toolchain. |
| `CGO_ENABLED=1` | `mattn/go-sqlite3` is CGO-based. Pure-Go alternatives (`modernc.org/sqlite`) were unavailable in the build environment. |

The `Makefile` sets all three automatically. **Always use `make test` / `make build`** rather than bare `go` commands.

---

## Running the frontend

```bash
cd frontend
npm install
npm run dev       # dev server (http://localhost:5173)
npm test          # Vitest (jsdom)
npm run check     # svelte-check + tsc
npm run lint      # eslint
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `DATABASE_PATH` | `notes.db` | Path to SQLite file |
| `DATABASE_URL` | — | If set, use PostgreSQL instead of SQLite (e.g. `postgres://user:pass@host/db`) |
| `ADMIN_USERNAME` | — | Seeded on first run if no users exist |
| `ADMIN_PASSWORD` | — | Seeded on first run if no users exist |
| `SESSION_TTL_DAYS` | `7` | Session lifetime in days; refreshed on activity |
| `LOGIN_RATE_PER_MINUTE` | `5` | Per-IP rate limit on `POST /api/auth/login` |
| `LOGIN_RATE_BURST` | `5` | Burst allowance for the login limiter |
| `BEARER_RATE_PER_MINUTE` | `600` | Per-IP rate limit applied only to requests carrying an `Authorization` header |
| `BEARER_RATE_BURST` | `300` | Burst allowance for the bearer-auth limiter |

---

## Database

### Drivers

- **SQLite** (default): `mattn/go-sqlite3` v1.14, CGO, FTS5 enabled via build tag
- **PostgreSQL**: `lib/pq` v1.12

### Migrations

Migrations live in `backend/internal/db/migrations/` as versioned SQL files (`000001_name.up.sql` / `000001_name.down.sql`) and are embedded into the binary via `//go:embed`. Applied automatically on startup; tracked in a `schema_migrations` table.

> `golang-migrate` was considered but skipped — its transitive dependency `go.uber.org/atomic` could not be fetched in the build environment. The custom runner is ~100 lines and covers all required behaviour.

### Schema

| Table | Purpose |
|---|---|
| `users` | User accounts — username, bcrypt password hash, salt, admin flag, `api_tokens_enabled` flag |
| `api_tokens` | Bearer API tokens — SHA-256 hash, `cnp_`-prefixed display prefix, scope, expiry, `last_used_at`, `revoked_at` |
| `sessions` | Login sessions — token ID, user reference, expiry timestamp |
| `notes` | The notes themselves — title, body (markdown), starred/pinned/archived flags, per-user |
| `tags` | Tag definitions — name, per-user, unique per user |
| `note_tags` | Many-to-many join between notes and tags |
| `trash` | Soft-delete records — points to a note in `notes`, records when it was deleted (permanent deletion after 30 days) |
| `schema_migrations` | Migration tracking — records which `.up.sql` files have been applied |
| `notes_fts` | FTS5 virtual table mirroring `notes.title` + `notes.body`; kept in sync via INSERT/UPDATE/DELETE triggers |
| `notes_fts_data` | FTS5 internal: inverted index B-tree data |
| `notes_fts_config` | FTS5 internal: configuration metadata |
| `notes_fts_docsize` | FTS5 internal: per-document token counts |
| `notes_fts_idx` | FTS5 internal: segment index for fast prefix lookups |

The four `notes_fts_*` tables are managed entirely by SQLite — never written to directly.

---

## Adding Go dependencies

`storage.googleapis.com` (the Go module proxy CDN) is unreachable in this environment. Use `GOPROXY=direct` to fetch from VCS hosts (GitHub, etc.) directly:

```bash
GOPROXY=direct GOTOOLCHAIN=local go get github.com/some/package@latest
```

Packages on non-GitHub hosts (e.g. `go.uber.org`, `golang.org/x/...`) must either be available in the local module cache or fetched via a reachable mirror.

---

## Authentication

- All `/api/*` routes except `POST /api/auth/login` require a valid session cookie
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`; stored server-side in the `sessions` table
- Passwords hashed with bcrypt cost=12; timing-safe dummy comparison on unknown usernames
- Logout deletes the session row immediately (reliable revocation)
- Admin users are seeded from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars on first run

### Auth endpoints

```
POST  /api/auth/login    { username, password } → sets session cookie
POST  /api/auth/logout   clears cookie + deletes session row
GET   /api/auth/me       returns current user (requires auth)
```

---

## API tokens

For external clients (CLIs, scripts) that can't carry a session cookie. Every
`/api/*` route accepts either a session cookie **or** an `Authorization: Bearer`
header — bearer auth is checked first.

### Getting a token

1. Log in to the web UI and open **Settings → Developer**.
2. Admins can create tokens for themselves at any time. Non-admins must be
   enabled first — an admin toggles **API tokens** on for that user under
   **Settings → User management**.
3. Pick a name, a scope (`read` or `read_write`), and an expiry (default 90
   days; `-1` = never). The raw token is shown **exactly once** on creation
   with a `cnp_` prefix. Copy it immediately; it is stored only as a SHA-256
   hash and cannot be recovered.

### Using a token

```bash
CNP_TOKEN=cnp_xxx curl -H "Authorization: Bearer $CNP_TOKEN" \
  http://localhost:8080/api/notes
```

### Scopes and restrictions

| Scope | Reads | Writes | Admin routes | Creating more tokens |
|---|---|---|---|---|
| `read` | ✅ | ❌ (403) | ❌ (403) | ❌ (403) |
| `read_write` | ✅ | ✅ | ❌ (403) | ❌ (403) |

A few rules are enforced regardless of scope, to limit the blast radius of a
leaked token:

- **Admin routes (`/api/admin/*`) are never reachable via bearer auth**, even
  when the token belongs to an admin. Admin actions require a cookie session.
- **Creating new tokens requires a cookie session** — a leaked token cannot
  mint more tokens and extend its own foothold.
- Revoking an admin's `api_tokens_enabled` flag for a non-admin user
  invalidates their outstanding tokens on the next verify.

### Lifecycle

- **Expiry**: configurable per-token; default 90 days.
- **Revocation**: per-token or revoke-all, either from the UI or via
  `DELETE /api/tokens/{id}` / `POST /api/tokens/revoke-all`.
- **Last-used tracking**: updated asynchronously via a buffered channel so
  verification stays off the hot path; drops on overflow rather than blocking.
- **Rate limiting**: a dedicated per-IP limiter (see `BEARER_RATE_*` env vars
  above) applies to any request carrying an `Authorization` header, whether or
  not the token ends up valid.

### Token endpoints

```
GET     /api/tokens              list your own tokens (no raw secrets)
POST    /api/tokens              create a token — cookie session only
DELETE  /api/tokens/{id}         revoke one of your tokens
POST    /api/tokens/revoke-all   revoke all of your tokens

PATCH   /api/admin/users/{id}/api-tokens    admin toggle {"enabled": bool}
```

---

## Docker

Multi-stage build: Node (frontend) → Go/gcc (backend + CGO + go:embed) → `distroless/cc` (final).

```bash
docker build -t crapnote .
docker run -p 8080:8080 \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=changeme \
  -e SESSION_SECRET=change-this \
  -v $(pwd)/data:/data \
  crapnote
```

For local dev with optional Postgres:

```bash
cd deploy && docker compose up
```

---

## Kubernetes

Manifests in `deploy/k8s/`. Single replica required (SQLite single-writer constraint).

- `deployment.yaml` — liveness + readiness probes on `GET /api/health`
- `service.yaml`
- `ingress.yaml` — Traefik `IngressRoute` with TLS (update `Host(...)` rule)
- `pvc.yaml` — 1Gi PVC for the SQLite file at `/data/notes.db`
- `secret.yaml` — template only; populate with `kubectl create secret`

---

## TDD conventions

- Backend: `go test -tags sqlite_fts5 ./...` — real in-memory SQLite for all repository/service tests, `httptest` for handler tests; no mocks
- Frontend: Vitest + `@testing-library/svelte` with jsdom; `resolve.conditions: ['browser']` required for Svelte 5 client-side mounting
- Order per feature: migration → repository test → repository → service test → service → handler test → handler → frontend component test → component
