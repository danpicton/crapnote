package notes

// This file is compiled only for tests, so nothing here widens the package's
// real API.

// SetZeroRowWindow installs fn as the hook that runs between a guarded write
// which matched no rows and the read that explains why, and returns a function
// restoring the previous hook. Tests use it to land a concurrent writer in that
// window deterministically instead of racing for it.
func SetZeroRowWindow(fn func()) func() {
	prev := zeroRowWindow
	zeroRowWindow = fn
	return func() { zeroRowWindow = prev }
}
