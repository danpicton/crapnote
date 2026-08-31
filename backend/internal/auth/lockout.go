package auth

import (
	"sort"
	"sync"
	"time"
)

// Automatic failed-login lockout is scoped to a (client IP, username) pair
// rather than to the account.
//
// Locking the account handed anyone who could guess a username a renewable
// denial of service: MAX_FAILED_LOGIN_ATTEMPTS bad passwords once per
// cool-down window kept the real owner out indefinitely, at a request rate
// comfortably below the per-IP login limiter (issue #62). Counting per pair
// confines that to the address the guesses came from — the attacker locks out
// their own connection and the owner logs in from anywhere else, unaffected.
//
// The trade-off is that one address is now one bucket: users sharing an
// egress NAT share a bucket per username, so a colleague fumbling their own
// password can lock the pair for everyone behind that gateway. That is
// strictly narrower than the account-wide lock it replaces, which any
// attacker could trip from anywhere.
//
// Admin locks (UserRepo.Lock) are untouched by all of this: they stay on the
// user row, global and indefinite.
//
// The state lives in memory rather than in the database. It is per-process
// security telemetry with no value after a restart, it is written on every
// failed login (a table would add write amplification to the one endpoint an
// attacker can hammer, plus a migration and a purge job), and a restart
// clearing an attacker's progress costs little — the per-IP rate limiter and
// bcrypt's cost still stand. Single-process is the same assumption
// internal/ratelimit already makes; a multi-replica deployment would need a
// shared store for both.
const (
	// maxLockoutEntries caps the table. Entries are ~100 bytes, so the
	// ceiling is a megabyte or so of attacker-controlled memory.
	maxLockoutEntries = 10000

	// lockoutIdleTTL is how long a pair's state survives with no activity
	// once it is no longer serving a lockout.
	lockoutIdleTTL = time.Hour

	// lockoutGCInterval bounds how often a sweep runs, keeping recordFailure
	// O(1) amortised the way ratelimit.Limiter does.
	lockoutGCInterval = time.Minute

	// lockoutEvictFraction is the reciprocal of the share of the table
	// dropped when it is full and a sweep freed nothing — evicting in
	// batches keeps the O(n log n) sort rare.
	lockoutEvictFraction = 4
)

// lockoutKey identifies one (client IP, username) pair. The username is the
// account's stored spelling, not the submitted one, so case or whitespace
// variants cannot each get their own budget.
type lockoutKey struct {
	ip       string
	username string
}

type lockoutEntry struct {
	failures    int
	lockedUntil time.Time // zero unless a cool-down is or was running
	indefinite  bool      // set when the policy's cool-down is <= 0
	lastSeen    time.Time
}

func (e *lockoutEntry) isLocked(now time.Time) bool {
	return e.indefinite || now.Before(e.lockedUntil)
}

// lockoutTracker holds the automatic failed-login state for every
// (client IP, username) pair. The zero value is not usable; call
// newLockoutTracker.
type lockoutTracker struct {
	mu      sync.Mutex
	entries map[lockoutKey]*lockoutEntry
	lastGC  time.Time
	now     func() time.Time // swapped in tests
}

func newLockoutTracker() *lockoutTracker {
	return &lockoutTracker{
		entries: make(map[lockoutKey]*lockoutEntry),
		now:     time.Now,
	}
}

// locked reports whether the pair is currently serving an automatic lockout.
func (t *lockoutTracker) locked(k lockoutKey) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	e, ok := t.entries[k]
	return ok && e.isLocked(t.now())
}

// recordFailure counts one wrong password for the pair, locking it once
// maxAttempts consecutive misses have accumulated. A cooldown of zero or less
// makes the lock indefinite for that pair.
func (t *lockoutTracker) recordFailure(k lockoutKey, maxAttempts int, cooldown time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := t.now()
	t.gcLocked(now)

	e, ok := t.entries[k]
	if !ok {
		if len(t.entries) >= maxLockoutEntries {
			t.evictLocked(now)
		}
		e = &lockoutEntry{}
		t.entries[k] = e
	}
	e.lastSeen = now

	if e.isLocked(now) {
		// Already serving a cool-down, and deliberately not extended. Rolling
		// the window forward buys nothing — Login answers these guesses with
		// the generic invalid-credentials error whether the pair is locked or
		// not, so the lock is not what is stopping them — while any client
		// retrying on a stale saved password would otherwise lock its own
		// address out permanently.
		return
	}
	if !e.lockedUntil.IsZero() {
		// A lapsed cool-down: the next cycle starts from a clean slate rather
		// than leaving the pair one miss from re-locking for ever.
		e.failures = 0
		e.lockedUntil = time.Time{}
	}

	e.failures++
	if e.failures < maxAttempts {
		return
	}
	if cooldown > 0 {
		e.lockedUntil = now.Add(cooldown)
	} else {
		e.indefinite = true
	}
}

// clear drops the pair's state, e.g. after a successful login.
func (t *lockoutTracker) clear(k lockoutKey) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.entries, k)
}

// clearUsername drops the state for a username across every address. It backs
// the admin unlock, which is what keeps an indefinite automatic lock
// recoverable without restarting the process.
func (t *lockoutTracker) clearUsername(username string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for k := range t.entries {
		if k.username == username {
			delete(t.entries, k)
		}
	}
}

// size reports how many pairs are tracked (for tests and metrics).
func (t *lockoutTracker) size() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.entries)
}

// gcLocked drops pairs that are neither locked nor recently active. Caller
// must hold t.mu. It runs at most once per lockoutGCInterval so an attacker
// cannot force a full sweep on every request.
func (t *lockoutTracker) gcLocked(now time.Time) {
	if now.Sub(t.lastGC) < lockoutGCInterval {
		return
	}
	t.lastGC = now
	for k, e := range t.entries {
		if e.isLocked(now) {
			continue
		}
		if now.Sub(e.lastSeen) > lockoutIdleTTL {
			delete(t.entries, k)
		}
	}
}

// evictLocked makes room when the table is full and a sweep freed nothing —
// an attacker cycling addresses and usernames would otherwise grow it without
// bound, which is a denial of service of its own. Caller must hold t.mu.
//
// Pairs that are not serving a lockout go first, then the least recently
// seen, so the flooding an attacker can afford costs them their own standing
// locks last. Indefinite locks can still be evicted this way; that is the
// documented ceiling on "indefinite" for a pair.
func (t *lockoutTracker) evictLocked(now time.Time) {
	keys := make([]lockoutKey, 0, len(t.entries))
	for k := range t.entries {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := t.entries[keys[i]], t.entries[keys[j]]
		if al, bl := a.isLocked(now), b.isLocked(now); al != bl {
			return !al
		}
		return a.lastSeen.Before(b.lastSeen)
	})

	drop := len(keys) / lockoutEvictFraction
	if drop == 0 {
		drop = 1
	}
	for _, k := range keys[:drop] {
		delete(t.entries, k)
	}
}
