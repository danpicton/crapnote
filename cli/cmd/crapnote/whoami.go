package main

import "fmt"

// cmdWhoami implements 'crapnote whoami': show who the token authenticates as.
func cmdWhoami(e *env, args []string) int {
	fs := newFlagSet(e, "whoami")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return parseCode(err)
	}
	if len(pos) != 0 {
		return e.usageError("whoami takes no arguments")
	}
	me, err := e.client.Me(e.ctx)
	if err != nil {
		return e.fail(err)
	}
	if e.json {
		return e.emitJSON(me)
	}
	role := "user"
	if me.IsAdmin {
		role = "admin"
	}
	fmt.Fprintf(e.stdout, "%s (id %d, %s)\n", me.Username, me.ID, role)
	return exitOK
}
