package ratelimit_test

import (
	"testing"
	"time"

	"github.com/danpicton/crapnote/internal/ratelimit"
)

// Burst fills the bucket, then requests are denied until tokens refill.
func TestLimiter_AllowsBurstThenDenies(t *testing.T) {
	l := ratelimit.New(1, 3) // 1 token per second, burst of 3

	for i := 0; i < 3; i++ {
		if !l.Allow("1.2.3.4") {
			t.Fatalf("expected request %d allowed, got denied", i+1)
		}
	}

	if l.Allow("1.2.3.4") {
		t.Fatal("expected 4th request denied after burst")
	}
}

// Separate keys have independent buckets.
func TestLimiter_PerKeyIsolation(t *testing.T) {
	l := ratelimit.New(1, 1)

	if !l.Allow("a") {
		t.Fatal("a first request should be allowed")
	}
	if l.Allow("a") {
		t.Fatal("a second request should be denied")
	}
	if !l.Allow("b") {
		t.Fatal("b first request should be allowed (independent bucket)")
	}
}

// Tokens refill over time.
func TestLimiter_RefillsOverTime(t *testing.T) {
	l := ratelimit.New(100, 1) // 100 tokens/s, burst 1 — refills quickly

	if !l.Allow("k") {
		t.Fatal("first request should be allowed")
	}
	if l.Allow("k") {
		t.Fatal("immediate second request should be denied")
	}

	time.Sleep(50 * time.Millisecond) // should refill ~5 tokens; capped at 1
	if !l.Allow("k") {
		t.Fatal("request after refill should be allowed")
	}
}

// Stale buckets should be pruned so the map does not grow unbounded.
func TestLimiter_PrunesIdleBuckets(t *testing.T) {
	l := ratelimit.New(1, 1)
	l.SetTTL(10 * time.Millisecond)

	l.Allow("stale") // create bucket
	if n := l.Size(); n != 1 {
		t.Fatalf("expected 1 bucket, got %d", n)
	}

	time.Sleep(20 * time.Millisecond)
	l.Allow("fresh") // triggers pruning; "stale" should be removed

	if n := l.Size(); n != 1 {
		t.Fatalf("expected 1 bucket after prune, got %d", n)
	}
}
