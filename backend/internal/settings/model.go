package settings

import "errors"

// KeyGlobalTheme is the app_settings key holding the admin-chosen default
// theme that every client sees until a user picks their own.
const KeyGlobalTheme = "global_theme"

// ErrNotFound is returned when a setting key has no stored value.
var ErrNotFound = errors.New("setting not found")

// ErrInvalidTheme is returned when a theme id fails validation.
var ErrInvalidTheme = errors.New("invalid theme id")
