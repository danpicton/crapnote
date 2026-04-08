package tags

import (
	"errors"
	"time"
)

// ErrNotFound is returned when a tag does not exist or belongs to another user.
var ErrNotFound = errors.New("tag not found")

// Tag represents a user-owned label that can be applied to notes.
type Tag struct {
	ID        int64
	UserID    int64
	Name      string
	CreatedAt time.Time
}

// TagWithCount wraps a Tag with the number of notes it is applied to.
type TagWithCount struct {
	Tag
	NoteCount int
}
