BINARY := /tmp/crapnote-server

.PHONY: build test-e2e test-backend test-frontend

## build: build frontend + backend (delegates to backend/Makefile)
build:
	$(MAKE) -C backend build-prod
	cp backend/server $(BINARY)

## test-e2e: build everything then run Playwright tests
test-e2e: build
	cd e2e && SERVER_BIN=$(BINARY) npx playwright test

## test-backend: run Go tests
test-backend:
	$(MAKE) -C backend test

## test-frontend: run Vitest unit tests
test-frontend:
	cd frontend && npm test
