---
name: crapnote
description: >-
  How to develop features, fix bugs, and make changes in the CrapNote PWA project — a SvelteKit 5 + Go + SQLite note-taking application.
  Use this skill whenever working on the crapnote codebase, including adding features, fixing bugs, writing tests, refactoring,
  working with the editor, database migrations, API endpoints, frontend components, deployment config, or any code changes in this repo.
  Trigger on any task that touches Go backend code, SvelteKit frontend code, SQLite/PostgreSQL schemas, Docker/K8s config,
  or the E2E test suite in this project.
---

# CrapNote Development Skill

CrapNote is a PWA note-taking application. The Go backend serves a REST API and embeds the SvelteKit frontend via `go:embed`. SQLite is the default database (PostgreSQL optional via `DATABASE_URL`).

## The One Rule: Red-Green-Refactor TDD

Every change follows strict red-green-refactor TDD. The cycle is non-negotiable:

1. **Red** — Write a failing test that describes the behaviour you want. Run it. Watch it fail. If it doesn't fail, the test is wrong or the behaviour already exists.
2. **Green** — Write the *simplest* code that makes the test pass. No more. Resist the urge to "while I'm here" — that comes next.
3. **Refactor** — Clean up duplication, improve naming, extract helpers. All tests still pass.
4. **Repeat** — Pick the next small behaviour and start again.

Do not write implementation code beyond scaffolding without a failing test first. "Scaffolding" means only: empty files, type stubs, function signatures that return zero values — enough for the compiler to accept the test file, nothing that encodes business logic.

When the feature involves multiple layers (migration, repository, service, handler, frontend), build bottom-up: each layer gets its own red-green-refactor cycle before moving to the next.

## Project Layout

```
/
├── backend/              # Go 1.24
│   ├── cmd/server/       # main entrypoint, HTTP mux, embedded SPA serving
│   ├── internal/
│   │   ├── auth/         # users, sessions, login/logout, admin middleware
│   │   ├── db/           # database connection, migration runner, go:embed migrations
│   │   │   └── migrations/  # versioned .up.sql / .down.sql files
│   │   ├── notes/        # notes CRUD, star, pin, archive, FTS5 search
│   │   ├── tags/         # per-user tags, note-tag associations
│   │   ├── trash/        # soft-delete, 7-day auto-purge background job
│   │   ├── export/       # ZIP export with bundled images
│   │   ├── images/       # image upload/serve (blob in SQLite)
│   │   ├── search/       # (if separate from notes)
│   │   └── middleware/    # logging (slog), Prometheus metrics
│   ├── go.mod            # module: github.com/danpicton/crapnote
│   └── Makefile          # build, test, lint, run targets
├── frontend/             # SvelteKit 5 (static adapter)
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api.ts           # HTTP client for all /api/* endpoints
│   │   │   ├── components/      # Editor.svelte (Milkdown-based rich markdown)
│   │   │   ├── stores/          # auth.svelte.ts, theme.svelte.test.ts
│   │   │   └── milkdown/        # editor plugins (image, link, underline)
│   │   ├── routes/              # SvelteKit file-based routing
│   │   │   ├── +page.svelte     # main notes list + inline editor
│   │   │   ├── notes/[id]/      # single note editing view
│   │   │   ├── login/           # login form
│   │   │   ├── archive/         # archived notes
│   │   │   ├── trash/           # trashed notes
│   │   │   ├── settings/        # theme toggle, user info
│   │   │   └── admin/           # user management (admin only)
│   │   └── __mocks__/           # test mocks for $app, lucide-svelte, etc.
│   ├── vitest.config.ts
│   └── package.json
├── e2e/                  # Playwright E2E tests
│   ├── tests/            # auth, notes, tags spec files
│   ├── global-setup.ts   # builds backend, starts server, seeds DB
│   └── playwright.config.ts  # single worker (SQLite constraint)
├── deploy/
│   ├── docker-compose.yml    # app + Prometheus + Loki + Grafana + Alloy
│   └── k8s/                  # deployment, service, ingress (Traefik), PVC, secret
└── Dockerfile            # multi-stage: node build → go build → distroless
```

## Architecture Patterns

Each backend domain package follows the same structure:

- **model.go** — Types, sentinel errors (e.g. `ErrNotFound`)
- **repository.go** — Direct SQL via `database/sql` (no ORM). Takes `*db.DB`.
- **service.go** — Business logic. Takes a `*Repo`. Thin layer over the repo — only adds logic the repo shouldn't own (defaults, validation, orchestration).
- **handler.go** — HTTP handlers. Takes a `*Service`. Reads from `auth.UserFromContext(r.Context())` for the current user. Returns JSON with appropriate status codes.
- **repository_test.go** — Integration tests against in-memory SQLite
- **service_test.go** — Tests through the service layer (still using real in-memory DB)
- **handler_test.go** — Uses `httptest.NewRecorder` with a real DB behind it

The Go module path is `github.com/danpicton/crapnote`. All internal packages live under `backend/internal/`.

The HTTP mux is Go 1.22+ stdlib (`http.ServeMux`) — no third-party router. Routes are registered in `cmd/server/server.go`.

## Build & Test Commands

### Backend

All Go commands require `-tags sqlite_fts5` and `CGO_ENABLED=1` (for `mattn/go-sqlite3`).

```bash
# From backend/ directory:
make test          # go test -tags sqlite_fts5 ./...
make build         # CGO_ENABLED=1 go build -tags sqlite_fts5 -o server ./cmd/server
make lint          # golangci-lint run -tags sqlite_fts5 ./...
make run           # CGO_ENABLED=1 go run -tags sqlite_fts5 ./cmd/server
```

Or directly:
```bash
cd backend && CGO_ENABLED=1 go test -tags sqlite_fts5 -run TestMyThing ./internal/notes/...
```

### Frontend

```bash
# From frontend/ directory:
npm test           # vitest run
npm run dev        # vite dev server (port 5173)
npm run build      # static build → ./build/
npm run check      # svelte-check + tsc
npm run lint       # eslint
```

Run a single test file:
```bash
cd frontend && npx vitest run src/routes/page.test.ts
```

### E2E

```bash
cd e2e && npx playwright test
```

E2E tests build the full stack (backend + frontend), start the server, and run Playwright with a single worker (SQLite single-writer constraint).

## Feature Build Order (TDD)

When adding a new feature, follow this sequence. Each step is its own red-green-refactor cycle:

### 1. Database Migration

If the feature needs schema changes:

- Write a new migration file: `backend/internal/db/migrations/NNNNNN_description.up.sql`
- Number it sequentially (check existing migrations for the next number)
- The migration runner (`db.Open`) applies pending migrations automatically on startup
- Test: the `db.Open(db.Config{SQLitePath: ":memory:"})` call in your repo tests exercises all migrations — if the migration has a syntax error, the test setup fails

### 2. Repository Layer (Integration Tests)

Write `repository_test.go` tests first:

```go
func TestRepo_MyFeature(t *testing.T) {
    // Setup: open in-memory DB, create prerequisite data
    database, err := db.Open(db.Config{SQLitePath: ":memory:"})
    if err != nil {
        t.Fatalf("open db: %v", err)
    }
    t.Cleanup(func() { database.Close() })

    repo := notes.NewRepo(database)

    // Test the specific behaviour
    // ...
}
```

Then implement the repository method to make the test pass.

### 3. Service Layer

Write `service_test.go` tests. Services use real repos with in-memory DBs — not mocks:

```go
func TestService_MyFeature(t *testing.T) {
    database, err := db.Open(db.Config{SQLitePath: ":memory:"})
    // ... create service, test business logic
}
```

### 4. HTTP Handler

Write `handler_test.go` tests using the existing fixture pattern:

```go
func TestHandler_MyEndpoint(t *testing.T) {
    h, user := newHandlerFixture(t)  // creates in-memory DB, user, service, handler

    req := httptest.NewRequest(http.MethodGet, "/api/...", nil)
    req = withUser(req, user)        // injects user into context
    w := httptest.NewRecorder()

    h.MyMethod(w, req)

    if w.Code != http.StatusOK {
        t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
    }
    // assert response body
}
```

### 5. Register the Route

Add the route in `backend/cmd/server/server.go`. The mux pattern uses Go 1.22+ syntax: `"GET /api/notes/{id}"`.

### 6. Frontend API Client

If the endpoint is new, add a method to `frontend/src/lib/api.ts`.

### 7. Frontend Component Tests

Write tests using Vitest + `@testing-library/svelte`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API client
vi.mock('$lib/api', () => ({
    api: {
        notes: { list: vi.fn(), create: vi.fn(), /* ... */ },
        // ...
    },
}));

// Mock the Milkdown editor (it uses browser APIs that break in jsdom)
vi.mock('$lib/components/Editor.svelte', async () => ({
    default: (anchor: unknown, props: unknown) => { void anchor; void props; },
}));
```

The Milkdown editor must always be mocked in unit tests — it depends on browser APIs not available in jsdom.

### 8. Frontend Component Implementation

Build the Svelte component to make the tests pass.

### 9. E2E Tests (When Appropriate)

For significant user-facing features, add a Playwright spec in `e2e/tests/`. E2E tests exercise the full stack.

## Testing Principles

- **No mocks where a real in-memory SQLite DB is practical.** The repo, service, and handler tests all use real databases. This catches SQL bugs and migration issues that mocks would hide.
- **Each test sets up its own DB.** The `db.Open(db.Config{SQLitePath: ":memory:"})` call creates a unique named in-memory database per call, so tests don't share state.
- **Frontend mocks the API boundary, not internal logic.** Mock `$lib/api`, `$app/navigation`, the Milkdown editor, and `lucide-svelte` (icons). Don't mock Svelte stores or component internals.
- **Test behaviour, not implementation.** Assert on HTTP status codes, response bodies, rendered text — not on which internal method was called.

## Database Notes

- SQLite is default. PostgreSQL is opt-in via `DATABASE_URL` env var.
- FTS5 virtual table (`notes_fts`) syncs automatically via triggers on the `notes` table.
- The `-tags sqlite_fts5` build tag is mandatory — without it, FTS5 migrations fail at runtime.
- In-memory SQLite DBs use a unique random name per `db.Open` call to prevent cross-test contamination.
- All timestamps are stored as UTC.

## Authentication Pattern

- All routes except `POST /api/auth/login` require a valid session cookie.
- Session middleware extracts the user and injects it into the request context.
- Handlers retrieve the current user via `auth.UserFromContext(r.Context())`.
- In handler tests, use `withUser(req, user)` to simulate authenticated requests.
- Admin-only endpoints check `user.IsAdmin` and return 403 if false.

## Frontend Editor

The editor uses Milkdown (ProseMirror-based) for live markdown rendering. Key points:

- The editor component is at `frontend/src/lib/components/Editor.svelte`
- Custom plugins live in `frontend/src/lib/milkdown/` (image paste, link, underline)
- The first line is always the title (rendered as H1)
- Auto-save triggers on blur
- In tests, always mock the editor — it requires real DOM APIs

## Environment Variables

```
DATABASE_PATH       # SQLite file path (default: /data/notes.db)
DATABASE_URL        # PostgreSQL connection string (overrides SQLite if set)
ADMIN_USERNAME      # Seeded on first run if no users exist
ADMIN_PASSWORD      # Seeded on first run if no users exist
SESSION_SECRET      # Secret for signing session tokens
SESSION_TTL_DAYS    # Session lifetime (default: 7)
PORT                # HTTP port (default: 8080)
```

## Common Gotchas

- **Forgot `-tags sqlite_fts5`**: Tests will fail with migration errors. Always use `make test` or pass the tag explicitly.
- **Forgot `CGO_ENABLED=1`**: The sqlite3 driver needs CGO. Set it for `go build`, `go run`, and `go test`.
- **FTS5 trigger sync**: When inserting/updating notes directly in tests via SQL (not through the repo), the FTS5 triggers handle sync automatically. But if you're writing migration tests that manipulate the `notes_fts` table directly, be aware of this.
- **Milkdown in tests**: Always mock `$lib/components/Editor.svelte` in Vitest tests. The real component hangs in jsdom.
- **E2E single worker**: Playwright runs with `workers: 1` because SQLite doesn't support concurrent writers. Don't change this.
- **Go 1.24 route patterns**: Routes use `"METHOD /path/{param}"` syntax. The `{param}` is accessed via `r.PathValue("param")`.
