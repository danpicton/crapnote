package tokens

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// UsageRecorder records token last-used-at timestamps out of band so that
// bearer-authenticated API requests don't pay for an extra DB write on every
// call. Record is non-blocking: if the internal buffer is full, the event is
// dropped. This is intentional — "last_used_at" is an audit hint, not a
// correctness guarantee, and stalling the request path to update it would
// turn a best-effort counter into a latency or availability risk.
type UsageRecorder struct {
	svc       *Service
	ch        chan usageEvent
	now       func() time.Time
	logger    *slog.Logger
	done      chan struct{}
	closeOnce sync.Once
}

type usageEvent struct {
	tokenID int64
	ts      time.Time
}

// NewUsageRecorder returns a recorder with the given buffer size. The caller
// must call Start() to begin consuming events.
func NewUsageRecorder(svc *Service, bufferSize int) *UsageRecorder {
	if bufferSize <= 0 {
		bufferSize = 256
	}
	return &UsageRecorder{
		svc:    svc,
		ch:     make(chan usageEvent, bufferSize),
		now:    time.Now,
		logger: slog.Default(),
		done:   make(chan struct{}),
	}
}

// Start launches the background drain loop. It returns immediately. The loop
// exits when ctx is cancelled or Stop is called.
func (r *UsageRecorder) Start(ctx context.Context) {
	go r.run(ctx)
}

// Record enqueues a last-used update for tokenID. Non-blocking: drops the
// event if the buffer is full.
func (r *UsageRecorder) Record(tokenID int64) {
	select {
	case r.ch <- usageEvent{tokenID: tokenID, ts: r.now()}:
	default:
		// Buffer full: drop. Intentional — see type doc.
	}
}

// Stop closes the input channel. The drain loop will finish in-flight writes
// and exit. Safe to call more than once.
func (r *UsageRecorder) Stop() {
	r.closeOnce.Do(func() { close(r.ch) })
	<-r.done
}

func (r *UsageRecorder) run(ctx context.Context) {
	defer close(r.done)
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-r.ch:
			if !ok {
				return
			}
			// Use a detached context so a cancelled parent doesn't abort a
			// write already in flight; cap it to a short timeout so a stuck
			// DB can't keep the goroutine alive forever.
			writeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := r.svc.RecordUsage(writeCtx, ev.tokenID, ev.ts); err != nil {
				r.logger.Warn("record token usage", "token_id", ev.tokenID, "error", err)
			}
			cancel()
		}
	}
}
