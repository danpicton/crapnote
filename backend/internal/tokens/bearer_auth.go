package tokens

import (
	"context"

	"github.com/danpicton/crapnote/internal/auth"
)

// BearerAuth adapts a tokens.Service to the auth.BearerAuthenticator
// interface, so the auth middleware can verify bearer tokens without taking a
// direct dependency on this package.
type BearerAuth struct {
	svc      *Service
	recorder *UsageRecorder
}

// NewBearerAuth wires the service and (optional) usage recorder.
func NewBearerAuth(svc *Service, recorder *UsageRecorder) *BearerAuth {
	return &BearerAuth{svc: svc, recorder: recorder}
}

// AuthenticateBearer implements auth.BearerAuthenticator.
func (b *BearerAuth) AuthenticateBearer(ctx context.Context, raw string) (*auth.User, string, int64, error) {
	v, err := b.svc.Verify(ctx, raw)
	if err != nil {
		return nil, "", 0, err
	}
	return v.User, string(v.Scope), v.TokenID, nil
}

// RecordTokenUsage implements auth.BearerAuthenticator. Non-blocking.
func (b *BearerAuth) RecordTokenUsage(tokenID int64) {
	if b.recorder != nil {
		b.recorder.Record(tokenID)
	}
}
