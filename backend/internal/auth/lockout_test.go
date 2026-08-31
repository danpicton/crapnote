package auth

import (
	"fmt"
	"testing"
	"time"
)

// The (IP, username) attempt table is fed by unauthenticated requests, so an
// attacker cycling addresses and usernames writes a new entry per request. An
// unbounded map is a denial of service in its own right — worse than the one
// the scoping fixes — so it has to prune and, failing that, evict.

func TestLockoutTracker_PrunesIdleEntries(t *testing.T) {
	tr := newLockoutTracker()
	base := time.Now()
	tr.now = func() time.Time { return base }

	for i := 0; i < 50; i++ {
		tr.recordFailure(lockoutKey{ip: fmt.Sprintf("10.0.0.%d", i), username: "alice"}, 5, time.Minute)
	}
	if got := tr.size(); got != 50 {
		t.Fatalf("expected 50 entries, got %d", got)
	}

	// Well past both the cool-down and the idle window.
	tr.now = func() time.Time { return base.Add(2 * lockoutIdleTTL) }
	tr.recordFailure(lockoutKey{ip: "10.9.9.9", username: "bob"}, 5, time.Minute)

	if got := tr.size(); got != 1 {
		t.Fatalf("expected idle entries to be pruned, %d left", got)
	}
}

func TestLockoutTracker_KeepsLiveLocksThroughPruning(t *testing.T) {
	tr := newLockoutTracker()
	base := time.Now()
	tr.now = func() time.Time { return base }

	k := lockoutKey{ip: "10.0.0.1", username: "alice"}
	for i := 0; i < 3; i++ {
		tr.recordFailure(k, 3, 4*lockoutIdleTTL) // a cool-down longer than the idle window
	}
	if !tr.locked(k) {
		t.Fatal("expected the pair to be locked")
	}

	tr.now = func() time.Time { return base.Add(2 * lockoutIdleTTL) }
	tr.recordFailure(lockoutKey{ip: "10.9.9.9", username: "bob"}, 5, time.Minute)

	if !tr.locked(k) {
		t.Fatal("pruning must not drop an entry that is still serving a lockout")
	}
}

func TestLockoutTracker_IsBounded(t *testing.T) {
	tr := newLockoutTracker()
	base := time.Now()
	tr.now = func() time.Time { return base }

	// Every request arrives in the same instant, so nothing is idle enough to
	// prune — only the capacity cap can hold the table down.
	for i := 0; i < maxLockoutEntries+2000; i++ {
		tr.recordFailure(lockoutKey{ip: fmt.Sprintf("10.%d.%d.%d", i>>16&0xff, i>>8&0xff, i&0xff),
			username: "alice"}, 5, time.Minute)
	}

	if got := tr.size(); got > maxLockoutEntries {
		t.Fatalf("tracker grew past its cap: %d > %d", got, maxLockoutEntries)
	}
}

func TestLockoutTracker_EvictsUnlockedEntriesFirst(t *testing.T) {
	tr := newLockoutTracker()
	base := time.Now()
	tr.now = func() time.Time { return base }

	// One standing lock, recorded first so it is also the least recently seen
	// — eviction would take it on age alone if it did not prefer entries that
	// are not serving a lockout.
	locked := lockoutKey{ip: "10.255.255.255", username: "alice"}
	for i := 0; i < 3; i++ {
		tr.recordFailure(locked, 3, time.Hour)
	}

	tr.now = func() time.Time { return base.Add(time.Second) }
	for i := 0; i < maxLockoutEntries+2000; i++ {
		tr.recordFailure(lockoutKey{ip: fmt.Sprintf("10.%d.%d.%d", i>>16&0xff, i>>8&0xff, i&0xff),
			username: "bob"}, 5, time.Hour)
	}

	if !tr.locked(locked) {
		t.Fatal("an attacker flooding the table must not be able to evict their own standing lock first")
	}
}
