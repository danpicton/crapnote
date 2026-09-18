package importer

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/notes"
)

var (
	ErrInvalidArchive = errors.New("invalid import archive")
	ErrQuota          = errors.New("imported images would exceed your image storage quota")
)

// Config controls archive and per-user image storage limits.
type Config struct {
	Limits          Limits
	ImageQuotaBytes int64
}

func DefaultConfig() Config {
	return Config{Limits: DefaultLimits(), ImageQuotaBytes: images.DefaultConfig().QuotaBytes}
}

// Result summarises a completed import.
type Result struct {
	ImportedNotes int `json:"imported_notes"`
}

// Service validates and atomically stores imported archives.
type Service struct {
	db     *sql.DB
	config Config
}

func NewService(database *sql.DB, config Config) *Service {
	defaults := DefaultConfig()
	if config.Limits.MaxEntries <= 0 {
		config.Limits.MaxEntries = defaults.Limits.MaxEntries
	}
	if config.Limits.MaxTotalBytes <= 0 {
		config.Limits.MaxTotalBytes = defaults.Limits.MaxTotalBytes
	}
	if config.ImageQuotaBytes <= 0 {
		config.ImageQuotaBytes = defaults.ImageQuotaBytes
	}
	return &Service{db: database, config: config}
}

// Import is a convenience for callers that already hold an archive in memory.
// The HTTP handler uses ImportReader directly on its temporary upload file.
func (s *Service) Import(ctx context.Context, userID int64, data []byte, password string) (Result, error) {
	return s.ImportReader(ctx, userID, bytes.NewReader(data), int64(len(data)), password)
}

// ImportReader retains only metadata and a single bounded entry at a time.
// Each entry is authenticated/validated before insertion; the transaction is
// committed only after ALL entries pass, including late password/CRC failures.
func (s *Service) ImportReader(ctx context.Context, userID int64, source io.ReaderAt, size int64, password string) (Result, error) {
	archive, err := openArchive(source, size, password, s.config.Limits)
	if err != nil {
		return Result{}, fmt.Errorf("%w: %w", ErrInvalidArchive, err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, fmt.Errorf("begin import: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op after commit

	var used int64
	if err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(LENGTH(data)), 0) FROM images WHERE user_id = ?`, userID,
	).Scan(&used); err != nil {
		return Result{}, fmt.Errorf("check image quota: %w", err)
	}
	if used+archive.imageBytes > s.config.ImageQuotaBytes {
		return Result{}, ErrQuota
	}

	newIDs := make(map[string]string, len(archive.images))
	for _, file := range archive.images {
		if err := ctx.Err(); err != nil {
			return Result{}, err
		}
		data, err := readEntry(file)
		if err != nil {
			return Result{}, fmt.Errorf("%w: %w", ErrInvalidArchive, err)
		}
		mimeType, err := images.ValidateData(data)
		if err != nil {
			return Result{}, fmt.Errorf("%w: invalid bundled image %q: %v", ErrInvalidArchive, file.Name, err)
		}
		id := images.NewID()
		newIDs[file.Name] = id
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO images (id, user_id, mime_type, data) VALUES (?, ?, ?, ?)`,
			id, userID, mimeType, data,
		); err != nil {
			return Result{}, fmt.Errorf("store imported image: %w", err)
		}
	}

	rewriter := imageRewriter(newIDs)
	assigned := make(map[string]bool)
	now := time.Now().UTC()
	for _, file := range archive.notes {
		if err := ctx.Err(); err != nil {
			return Result{}, err
		}
		note, err := readNote(file, assigned)
		if err != nil {
			return Result{}, fmt.Errorf("%w: %w", ErrInvalidArchive, err)
		}
		// Rewrite only paths actually present in this archive. Even a UUID-
		// shaped absent path can be an ordinary link preserved by export.Build;
		// no filename heuristic can distinguish it from a deleted bundle.
		body := rewriter.Replace(note.Body)
		if err := notes.ValidateContent(note.Title, body); err != nil {
			return Result{}, fmt.Errorf("%w: invalid note %q: %v", ErrInvalidArchive, note.Title, err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO notes (user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
			userID, note.Title, body, now, now,
		); err != nil {
			return Result{}, fmt.Errorf("store imported note: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("commit import: %w", err)
	}
	return Result{ImportedNotes: len(archive.notes)}, nil
}

func imageRewriter(newIDs map[string]string) *strings.Replacer {
	// Longest first avoids a shorter entry consuming another entry's prefix.
	paths := make([]string, 0, len(newIDs))
	for path := range newIDs {
		paths = append(paths, path)
	}
	sort.Slice(paths, func(i, j int) bool { return len(paths[i]) > len(paths[j]) })
	pairs := make([]string, 0, 2*len(paths))
	for _, path := range paths {
		pairs = append(pairs, path, "/api/images/"+newIDs[path])
	}
	return strings.NewReplacer(pairs...)
}
