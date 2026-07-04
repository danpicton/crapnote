BINARY := /tmp/crapnote-server

# Env vars (override from the shell, e.g. ADMIN_PASSWORD=hunter2 make run)
# PUBLIC_* vars are read by Vite at build time, so they're exported to all
# child processes — including the frontend build invoked via backend/Makefile.
# ADMIN_PASSWORD has no default on purpose: the initial admin is seeded into
# the database on first run, so `make run` refuses to start without one rather
# than silently creating a well-known admin/admin login.
ADMIN_USERNAME          ?= admin
PUBLIC_SYNC_INTERVAL_MS ?= 20000
export PUBLIC_SYNC_INTERVAL_MS

.PHONY: build run require-admin-password test-e2e test-backend test-frontend \
        ci ci-full lint-backend lint-frontend check-frontend

## build: build frontend + backend (delegates to backend/Makefile)
build:
	$(MAKE) -C backend build-prod
	cp backend/server $(BINARY)

require-admin-password:
	@test -n "$(ADMIN_PASSWORD)" || { \
		echo "ERROR: ADMIN_PASSWORD is not set. The initial admin is seeded"; \
		echo "into the database on first run — set a strong password, e.g.:"; \
		echo "  ADMIN_PASSWORD='...' make run"; \
		exit 1; }

## run: build then run the embedded binary (production path)
run: require-admin-password build
	ADMIN_USERNAME=$(ADMIN_USERNAME) \
	ADMIN_PASSWORD=$(ADMIN_PASSWORD) \
	$(BINARY)

## test-e2e: build everything then run Playwright tests
test-e2e: build
	cd e2e && SERVER_BIN=$(BINARY) npx playwright test

## test-backend: run Go tests (with -race, matches CI)
test-backend:
	cd backend && CGO_ENABLED=1 go test -tags sqlite_fts5 -race ./...

## test-frontend: run Vitest unit tests
test-frontend:
	cd frontend && npm test

## lint-backend: go vet + golangci-lint (skips lint with warning if not installed)
lint-backend:
	cd backend && CGO_ENABLED=1 go vet -tags sqlite_fts5 ./...
	@if command -v golangci-lint >/dev/null 2>&1; then \
		$(MAKE) -C backend lint; \
	else \
		echo "⚠ golangci-lint not installed — skipping (CI will catch it)"; \
	fi

## lint-frontend: ESLint
lint-frontend:
	cd frontend && npm run lint

## check-frontend: svelte-check + tsc
check-frontend:
	cd frontend && npm run check

## ci: fast CI parity — lint + typecheck + unit tests (no e2e, no docker build)
ci: lint-backend test-backend lint-frontend check-frontend test-frontend
	@echo "✓ make ci passed"

## ci-full: full CI parity including Playwright e2e
ci-full: ci test-e2e
	@echo "✓ make ci-full passed"
