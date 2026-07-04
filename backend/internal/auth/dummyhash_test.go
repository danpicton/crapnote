package auth

import (
	"errors"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// The timing-equalisation placeholder must be a real cost-12 bcrypt hash. An
// invalid literal (like the old "$2a$12$dummy") fails during hash parsing and
// returns in microseconds instead of doing key-derivation work, which lets an
// attacker enumerate usernames by response time (issue #55).
func TestDummyPasswordHash_IsValidCost12(t *testing.T) {
	cost, err := bcrypt.Cost(dummyPasswordHash)
	if err != nil {
		t.Fatalf("dummyPasswordHash does not parse as a bcrypt hash: %v", err)
	}
	if cost != bcryptCost {
		t.Fatalf("dummyPasswordHash cost = %d, want %d", cost, bcryptCost)
	}

	// A comparison must reach the hashing step and report a mismatch — not a
	// parse failure like ErrHashTooShort.
	err = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte("any password"))
	if !errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
		t.Fatalf("expected ErrMismatchedHashAndPassword, got %v", err)
	}
}
