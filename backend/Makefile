TAGS        := sqlite_fts5
BUILD_FLAGS := -tags $(TAGS)
export GOTOOLCHAIN := local

FRONTEND_DIR := ../frontend
UI_DEST      := cmd/server/ui/build

.PHONY: build build-prod frontend test lint run apispec

# Development build (no frontend embed; placeholder index.html served)
build:
	CGO_ENABLED=1 go build $(BUILD_FLAGS) -o server ./cmd/server

# Production build: build frontend, copy into embed dir, then compile Go binary
build-prod: frontend
	CGO_ENABLED=1 go build $(BUILD_FLAGS) -o server ./cmd/server

# Build the SvelteKit frontend and copy output into the Go embed directory
frontend:
	cd $(FRONTEND_DIR) && npm ci && npm run build
	rm -rf $(UI_DEST)
	cp -r $(FRONTEND_DIR)/build $(UI_DEST)

test:
	go test $(BUILD_FLAGS) ./...

lint:
	golangci-lint run --build-tags $(TAGS) ./...

run:
	CGO_ENABLED=1 go run $(BUILD_FLAGS) ./cmd/server

# Regenerate the machine-readable API contract from the apispec registry.
# A test fails when this file is stale; the CLI's parity test consumes it.
apispec:
	go run ./cmd/apispecgen ../docs/api-contract.json
