package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/db"
	"golang.org/x/crypto/bcrypt"
)

// The tracker keeps a map entry per (client IP, submitted username) for every
// failed login, and both halves of that key arrive from an unauthenticated
// request. maxLockoutEntries caps how many entries there are; these tests cap
// how big one can get. Without that second bound a caller could park
// arbitrary attacker-chosen bytes in a live map key and keep them resident —
// a memory-exhaustion DoS built out of the mitigation for a different DoS.

// retainedKeyBytes measures what the tracker's keys actually hold: the key
// struct itself plus the contents of any string fields it carries.
//
// Deliberately reflective rather than a hand-written sum. A hand-written one
// would have to be edited to keep compiling if the key ever went back to
// storing raw submitted text, and would silently start under-reporting if
// someone added a string field — the exact regressions this is here to catch.
func retainedKeyBytes(tr *lockoutTracker) int {
	tr.mu.Lock()
	defer tr.mu.Unlock()

	total := 0
	for k := range tr.entries {
		v := reflect.ValueOf(k)
		total += int(v.Type().Size())
		for i := 0; i < v.NumField(); i++ {
			f := v.Field(i)
			if f.Kind() == reflect.String {
				total += f.Len()
			}
		}
	}
	return total
}

func TestLockoutTracker_KeyBytesDoNotGrowWithUsernameLength(t *testing.T) {
	const (
		entries      = 10
		usernameSize = 1 << 20 // 1 MiB, as the security review probed
	)

	tr := newLockoutTracker()
	base := time.Now()
	tr.now = func() time.Time { return base }

	huge := strings.Repeat("u", usernameSize)
	for i := 0; i < entries; i++ {
		tr.recordFailure(newLockoutKey(fmt.Sprintf("198.51.100.%d", i), huge), 5, time.Minute)
	}
	if got := tr.size(); got != entries {
		t.Fatalf("expected %d entries, got %d — the measurement below would be vacuous", entries, got)
	}

	// Keys must be fixed-size, so what a client submitted cannot influence
	// this at all. A generous ceiling: anything near entries*usernameSize
	// means the submitted text is resident.
	const ceiling = entries * 1024
	if got := retainedKeyBytes(tr); got > ceiling {
		t.Fatalf("keys retain %d bytes of attacker-chosen input (ceiling %d, submitted %d)",
			got, ceiling, entries*usernameSize)
	}
}

func TestLockoutTracker_ReclaimsWithoutFurtherFailedLogins(t *testing.T) {
	tr := newLockoutTracker()
	base := time.Now()
	tr.now = func() time.Time { return base }

	for i := 0; i < 100; i++ {
		tr.recordFailure(newLockoutKey(fmt.Sprintf("198.51.100.%d", i), "ghost"), 5, time.Minute)
	}
	if got := tr.size(); got != 100 {
		t.Fatalf("expected 100 entries, got %d", got)
	}

	// A year goes by and the attacker never comes back. Pruning that only
	// runs when a failure is recorded would hold the peak for ever; the check
	// every login attempt already performs has to reclaim too.
	tr.now = func() time.Time { return base.Add(365 * 24 * time.Hour) }
	tr.locked(newLockoutKey("203.0.113.4", "someone-else"))

	if got := tr.size(); got != 0 {
		t.Fatalf("expected idle entries to be reclaimed without further failures, %d left", got)
	}
}

// ── through the real handler ────────────────────────────────────────────────

func newMemoryFixture(t *testing.T) (*Handler, *Service) {
	t.Helper()
	database, err := db.Open(db.Config{SQLitePath: ":memory:"})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	users := NewUserRepo(database)
	svc := NewService(users, NewSessionRepo(database), 7*24*time.Hour)
	hash, err := bcrypt.GenerateFromPassword([]byte("correctpass"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if _, err := users.Create(context.Background(), "alice", string(hash), false); err != nil {
		t.Fatalf("create user: %v", err)
	}
	return NewHandler(svc), svc
}

func postLogin(t *testing.T, h *Handler, remoteAddr, username, password string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"username": username, "password": password})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = remoteAddr
	w := httptest.NewRecorder()
	h.Login(w, req)
	return w
}

func TestHandler_Login_RetainsNoAttackerChosenKeyBytes(t *testing.T) {
	h, svc := newMemoryFixture(t)

	// Long enough to dwarf a fixed-size key by orders of magnitude, small
	// enough to be accepted so the entry is really recorded — this test is
	// about what survives an accepted request, not about the body cap.
	const entries = 10
	long := strings.Repeat("u", 3000)

	for i := 0; i < entries; i++ {
		w := postLogin(t, h, fmt.Sprintf("198.51.100.%d:5555", i), long, "wrong")
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("request %d: expected 401, got %d: %s", i+1, w.Code, w.Body.String())
		}
	}
	if got := svc.attempts.size(); got != entries {
		t.Fatalf("expected %d tracked entries, got %d — the measurement below would be vacuous", entries, got)
	}

	const ceiling = entries * 1024
	if got := retainedKeyBytes(svc.attempts); got > ceiling {
		t.Fatalf("the handler left %d bytes of submitted username resident in keys (ceiling %d, submitted %d)",
			got, ceiling, entries*len(long))
	}
}

func TestHandler_Login_OversizedBodyIsRejected(t *testing.T) {
	h, svc := newMemoryFixture(t)

	// The reviewer's headline shape: an unauthenticated request carrying a
	// multi-megabyte username. It must not reach the tracker at all.
	w := postLogin(t, h, "198.51.100.7:5555", strings.Repeat("u", 4<<20), "wrong")

	if w.Code < 400 || w.Code >= 500 {
		t.Fatalf("expected a 4xx refusal for an oversized body, got %d: %s", w.Code, w.Body.String())
	}
	var decoded map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("oversized body must still get a clean JSON error, got %q: %v", w.Body.String(), err)
	}
	if decoded["error"] == "" {
		t.Fatalf("expected an error message, got %s", w.Body.String())
	}
	if got := svc.attempts.size(); got != 0 {
		t.Fatalf("a rejected oversized request must leave nothing tracked, got %d entries", got)
	}

	// A normal login still works afterwards — the cap must not wedge the route.
	if code := postLogin(t, h, "198.51.100.7:5555", "alice", "correctpass").Code; code != http.StatusOK {
		t.Fatalf("expected a normal login to still succeed, got %d", code)
	}
}

// Hashing the key must not quietly merge buckets. If two usernames shared one,
// driving a cool-down on a name of the attacker's choosing would put a name of
// their choosing into cool-down too — both a lockout DoS against an account
// they cannot log into and, since the 403 is observable, a signal that depends
// on something other than their own failure history.
func TestLockoutTracker_HashedKeysStayDistinct(t *testing.T) {
	tr := newLockoutTracker()
	base := time.Now()
	tr.now = func() time.Time { return base }

	const ip, other = "198.51.100.7", "203.0.113.4"
	for i := 0; i < 3; i++ {
		tr.recordFailure(newLockoutKey(ip, "alice"), 3, time.Hour)
	}
	if !tr.locked(newLockoutKey(ip, "alice")) {
		t.Fatal("expected (ip, alice) to be locked")
	}

	// A different username on the same address: untouched.
	if tr.locked(newLockoutKey(ip, "bob")) {
		t.Fatal("a different username must not inherit another's cool-down")
	}
	// The same username from a different address: untouched.
	if tr.locked(newLockoutKey(other, "alice")) {
		t.Fatal("a different address must not inherit another's cool-down")
	}
	// Case folding still happens, and still happens before hashing.
	if !tr.locked(newLockoutKey(ip, "ALICE")) {
		t.Fatal("case variants must share one budget, as they did before hashing")
	}
}

// A username of any length must produce a key of the same size as a one-byte
// one — the property that makes maxLockoutEntries a bound on bytes.
func TestLockoutKey_SizeIsIndependentOfInput(t *testing.T) {
	tr := newLockoutTracker()
	base := time.Now()
	tr.now = func() time.Time { return base }

	tr.recordFailure(newLockoutKey("10.0.0.1", "a"), 5, time.Minute)
	small := retainedKeyBytes(tr)

	tr = newLockoutTracker()
	tr.now = func() time.Time { return base }
	tr.recordFailure(newLockoutKey("10.0.0.1", strings.Repeat("u", 1<<20)), 5, time.Minute)
	large := retainedKeyBytes(tr)

	if small != large {
		t.Fatalf("key size varies with input: %d bytes for a 1-byte username, %d for a 1 MiB one",
			small, large)
	}
}
