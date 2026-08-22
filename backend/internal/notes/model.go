package notes

import (
	"errors"
	"time"
)

// ErrNotFound is returned when a note does not exist or belongs to another user.
var ErrNotFound = errors.New("note not found")

// ErrLocked is returned when an operation would change the content of a locked
// note. Callers must unlock the note first.
var ErrLocked = errors.New("note is locked")

// Note represents a single user note.
type Note struct {
	ID      int64
	UserID  int64
	Title   string
	Body    string
	Starred bool
	Pinned  bool
	// PinOrder positions this note among the user's pinned notes (ascending).
	// Always 0 for unpinned notes, so ordering falls through to UpdatedAt.
	PinOrder  int
	Archived  bool
	Locked    bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// ListFilter holds optional filters for listing notes.
type ListFilter struct {
	Starred *bool  // nil = no filter
	TagID   *int64 // nil = no filter
	Search  string // empty = no FTS filter
	Limit   int    // <=0 means no bound (used only for admin/exports)
	Offset  int
}
