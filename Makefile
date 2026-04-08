BINARY        := /tmp/crapnote-server
FRONTEND_SRC  := frontend
EMBED_DIR     := backend/cmd/server/ui/build
BACKEND_SRC   := backend

.PHONY: build build-frontend build-backend test-e2e test-backend test-frontend

## build: build frontend + backend (required before running e2e)
build: build-frontend build-backend

build-frontend:
	cd $(FRONTEND_SRC) && npm run build
	cp -r $(FRONTEND_SRC)/build/. $(EMBED_DIR)/

build-backend:
	cd $(BACKEND_SRC) && CGO_ENABLED=1 go build -tags fts5 -o $(BINARY) ./cmd/server/

## test-e2e: build everything then run Playwright tests
test-e2e: build
	cd e2e && SERVER_BIN=$(BINARY) npx playwright test

## test-backend: run Go tests
test-backend:
	cd $(BACKEND_SRC) && CGO_ENABLED=1 go test -tags fts5 -race ./...

## test-frontend: run Vitest unit tests
test-frontend:
	cd $(FRONTEND_SRC) && npm test
