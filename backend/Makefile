TAGS        := sqlite_fts5
BUILD_FLAGS := -tags $(TAGS)
export GOTOOLCHAIN := local

.PHONY: build test lint run

build:
	CGO_ENABLED=1 go build $(BUILD_FLAGS) -o server ./cmd/server

test:
	go test $(BUILD_FLAGS) ./...

lint:
	golangci-lint run $(BUILD_FLAGS) ./...

run:
	CGO_ENABLED=1 go run $(BUILD_FLAGS) ./cmd/server
