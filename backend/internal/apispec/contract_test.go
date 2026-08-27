package apispec

import (
	"bytes"
	"os"
	"testing"
)

// TestContractFileUpToDate fails when docs/api-contract.json has drifted
// from the registry. Regenerate with `make apispec` (backend/Makefile).
func TestContractFileUpToDate(t *testing.T) {
	want, err := ContractJSON()
	if err != nil {
		t.Fatalf("render contract: %v", err)
	}
	got, err := os.ReadFile("../../../docs/api-contract.json")
	if err != nil {
		t.Fatalf("read docs/api-contract.json (run `make apispec` in backend/): %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("docs/api-contract.json is stale — run `make apispec` in backend/ and commit the result")
	}
}
