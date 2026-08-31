package auth

import (
	"crypto/sha256"
	"sort"
	"strings"
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
	// maxLockoutEntries caps how many pairs are tracked. On its own that is a
	// cap on entry count only, which is worthless if an entry can be any
	// size; combined with the fixed-size key below it becomes a cap on bytes.
	// A key is exactly 64 bytes and an entry 64 more whatever was submitted,
	// so a saturated table is 1.86 MiB — measured at this cap with 1 MiB
	// usernames on every request, 195 bytes per entry including Go's map
	// overhead, and identical to three significant figures when the
	// usernames are short. No client can move that number.
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

// lockoutKey identifies one (client IP, username) pair.
//
// The username half is derived from the string the client submitted — not an
// account's stored spelling — because the lockout is consulted before any
// lookup happens, and because usernames matching no account have to
// accumulate failures exactly like real ones. If they did not, the cool-down
// response would only ever appear for accounts that exist, and would itself
// become the username oracle.
//
// Both halves are stored as SHA-256 digests rather than as the strings
// themselves, which makes the key a fixed 64 bytes no matter what arrived on
// the wire. That is a memory-safety property, not a secrecy one: these are
// live map keys built from an unauthenticated request body, so retaining the
// raw text let a caller park arbitrary megabytes in the table and keep them
// resident — maxLockoutEntries caps the number of entries but could never cap
// their size. Hashing also means the tracker holds no submitted credentials
// material at all. Digests are unsalted and never exposed; a collision would
// merely make two usernames share one address's cool-down budget, which is
// not something an attacker gains by.
type lockoutKey struct {
	ip       [sha256.Size]byte
	username [sha256.Size]byte
}

// newLockoutKey builds the key for one login attempt.
func newLockoutKey(ip, username string) lockoutKey {
	return lockoutKey{ip: sha256.Sum256([]byte(ip)), username: lockoutUsername(username)}
}

// lockoutUsername derives the username half of a key on its own, for lookups
// that span every address. Case is folded before hashing, so the spellings of
// one name cannot each claim their own budget — and cannot each claim their
// own table entry either.
func lockoutUsername(username string) [sha256.Size]byte {
	return sha256.Sum256([]byte(strings.ToLower(username)))
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

	now := t.now()
	// Sweep here too, not only when recording a failure. Login consults this
	// on every attempt, so reclamation no longer depends on the attacker
	// coming back: pruning solely from recordFailure meant a process that had
	// been flooded held its peak footprint for as long as it stayed up.
	t.gcLocked(now)

	e, ok := t.entries[k]
	return ok && e.isLocked(now)
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
		// Already serving a cool-down, and deliberately not extended. Login
		// short-circuits before it reaches here, so in practice this guards
		// the tracker's own invariant: a rolling window would let any client
		// retrying on a stale saved password lock its own address out
		// permanently.
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
	want := lockoutUsername(username)
	for k := range t.entries {
		if k.username == want {
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
