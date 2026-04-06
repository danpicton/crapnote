package trash

import (
	"errors"
	"time"
)

// ErrNotFound is returned when a trash entry does not exist or belongs to another user.
var ErrNotFound = errors.New("trash entry not found")

// PurgeDays is how long a note stays in trash before permanent deletion.
const PurgeDays = 7

// Entry represents a trashed note with its deletion metadata.
type Entry struct {
	NoteID            int64
	UserID            int64
	Title             string
	DeletedAt         time.Time
	PermanentDeleteAt time.Time // DeletedAt + PurgeDays
}
