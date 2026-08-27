package apispec

import (
	"bytes"
	"encoding/json"
)

// contractVersion bumps when the contract's shape (not its content) changes,
// so consumers can fail loudly on a format they don't understand.
const contractVersion = 1

type contract struct {
	Version    int         `json:"version"`
	Operations []Operation `json:"operations"`
}

// ContractJSON renders the registry as the canonical machine-readable
// contract checked in at docs/api-contract.json. The CLI's parity test (a
// separate Go module that cannot import this package) consumes that file.
func ContractJSON() ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetIndent("", "  ")
	if err := enc.Encode(contract{Version: contractVersion, Operations: Registry()}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
