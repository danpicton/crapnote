// Command apispecgen writes the API contract (the apispec registry rendered
// as JSON) to the path given as its only argument. Run via `make apispec`.
package main

import (
	"fmt"
	"os"

	"github.com/danpicton/crapnote/internal/apispec"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: apispecgen <output-path>")
		os.Exit(2)
	}
	data, err := apispec.ContractJSON()
	if err != nil {
		fmt.Fprintln(os.Stderr, "render contract:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(os.Args[1], data, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "write contract:", err)
		os.Exit(1)
	}
}
