# Developer Notes / TODOs

## Backend tests require the `sqlite_fts5` build tag

The backend uses SQLite's FTS5 extension for full-text search. The Go driver
(`mattn/go-sqlite3`) only enables FTS5 when compiled with the `sqlite_fts5`
build tag.

Running `go test ./...` **without** the tag will fail with:

```
no such module: fts5
```

Always use the tag when running backend tests locally:

```sh
go test -tags sqlite_fts5 ./...
# or, with the race detector (matches CI exactly):
go test -tags sqlite_fts5 -race ./...
```

The `Makefile` targets and CI workflow (`ci.yml`) already pass `-tags sqlite_fts5`
automatically — this only affects developers running `go test` directly.
