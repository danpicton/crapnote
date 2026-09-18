package importer

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"time"

	"github.com/danpicton/crapnote/internal/images"
	"github.com/danpicton/crapnote/internal/notes"
)

var (
	// ErrInvalidArchive identifies errors caused by archive content rather than storage.
	ErrInvalidArchive = errors.New("invalid import archive")
	// ErrQuota indicates that imported images would exceed the user's quota.
	ErrQuota = errors.New("imported images would exceed your image storage quota")
	// ErrMissingImage indicates that a note refers to a bundle entry that is absent.
	ErrMissingImage = errors.New("a note references a bundled image that is missing")
)

var imageReferencePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(!\[[^\]\r\n]*\]\(\s*<?)(images/[A-Za-z0-9._+-]+)`),
	regexp.MustCompile(`(?i)(<img\b[^>]*\bsrc\s*=\s*["']?)(images/[A-Za-z0-9._+-]+)`),
}

// Config controls archive and per-user image storage limits.
type Config struct {
	Limits          Limits
	ImageQuotaBytes int64
}

// DefaultConfig returns production import limits.
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

// NewService creates an import service.
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

// Import parses the archive and commits every image and note in one transaction.
func (s *Service) Import(ctx context.Context, userID int64, data []byte, password string) (Result, error) {
	archive, err := Parse(data, password, s.config.Limits)
	if err != nil {
		return Result{}, fmt.Errorf("%w: %w", ErrInvalidArchive, err)
	}

	paths := make([]string, 0, len(archive.Images))
	mimeTypes := make(map[string]string, len(archive.Images))
	newIDs := make(map[string]string, len(archive.Images))
	var importedImageBytes int64
	for archivePath, image := range archive.Images {
		mimeType, err := images.ValidateData(image.Data)
		if err != nil {
			return Result{}, fmt.Errorf("%w: invalid bundled image %q: %v", ErrInvalidArchive, archivePath, err)
		}
		paths = append(paths, archivePath)
		mimeTypes[archivePath] = mimeType
		newIDs[archivePath] = images.NewID()
		importedImageBytes += int64(len(image.Data))
	}
	sort.Strings(paths)

	rewritten := make([]Note, len(archive.Notes))
	for i, note := range archive.Notes {
		body, err := rewriteImageReferences(note.Body, newIDs)
		if err != nil {
			return Result{}, fmt.Errorf("%w: %w", ErrInvalidArchive, err)
		}
		if err := notes.ValidateContent(note.Title, body); err != nil {
			return Result{}, fmt.Errorf("%w: invalid note %q: %v", ErrInvalidArchive, note.Title, err)
		}
		rewritten[i] = Note{Title: note.Title, Body: body}
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
	if used+importedImageBytes > s.config.ImageQuotaBytes {
		return Result{}, ErrQuota
	}

	for _, archivePath := range paths {
		image := archive.Images[archivePath]
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO images (id, user_id, mime_type, data) VALUES (?, ?, ?, ?)`,
			newIDs[archivePath], userID, mimeTypes[archivePath], image.Data,
		); err != nil {
			return Result{}, fmt.Errorf("store imported image: %w", err)
		}
	}

	now := time.Now().UTC()
	for _, note := range rewritten {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO notes (user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
			userID, note.Title, note.Body, now, now,
		); err != nil {
			return Result{}, fmt.Errorf("store imported note: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("commit import: %w", err)
	}
	return Result{ImportedNotes: len(rewritten)}, nil
}

func rewriteImageReferences(body string, newIDs map[string]string) (string, error) {
	var rewriteErr error
	for _, pattern := range imageReferencePatterns {
		body = pattern.ReplaceAllStringFunc(body, func(match string) string {
			parts := pattern.FindStringSubmatch(match)
			if len(parts) != 3 {
				return match
			}
			id, ok := newIDs[parts[2]]
			if !ok {
				rewriteErr = fmt.Errorf("%w: %s", ErrMissingImage, parts[2])
				return match
			}
			return parts[1] + "/api/images/" + id
		})
		if rewriteErr != nil {
			return "", rewriteErr
		}
	}
	return body, nil
}
