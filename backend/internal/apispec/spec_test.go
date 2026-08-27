package apispec

import (
	"testing"
)

func TestRegistry_Invariants(t *testing.T) {
	ops := Registry()
	if len(ops) == 0 {
		t.Fatal("empty registry")
	}

	names := map[string]bool{}
	routes := map[string]bool{}
	validMethods := map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true}

	for _, op := range ops {
		if op.Name == "" || op.Description == "" {
			t.Errorf("op %q: name and description are required", op.Name)
		}
		if names[op.Name] {
			t.Errorf("duplicate op name %q", op.Name)
		}
		names[op.Name] = true

		route := op.Method + " " + op.Path
		if routes[route] {
			t.Errorf("duplicate route %q", route)
		}
		routes[route] = true

		if !validMethods[op.Method] {
			t.Errorf("op %q: invalid method %q", op.Name, op.Method)
		}
		if len(op.Path) < 5 || op.Path[:5] != "/api/" {
			t.Errorf("op %q: path %q must start with /api/", op.Name, op.Path)
		}
		switch op.Scope {
		case ScopePublic, ScopeRead, ScopeWrite:
		default:
			t.Errorf("op %q: invalid scope %q", op.Name, op.Scope)
		}
		if op.Scope == ScopePublic && (op.AdminOnly || op.CookieOnly) {
			t.Errorf("op %q: public ops cannot be admin-only or cookie-only", op.Name)
		}
		if op.AdminOnly && op.CookieOnly {
			t.Errorf("op %q: admin-only already implies cookie sessions; don't set both", op.Name)
		}
		if op.LoginRateLimited && op.Scope != ScopePublic {
			t.Errorf("op %q: login rate limiting only applies to public ops", op.Name)
		}
		if op.Request == "" || op.Response == "" {
			t.Errorf("op %q: request/response kind not defaulted", op.Name)
		}

		// Every {placeholder} in the path must have a required path param,
		// and every path param must appear in the path.
		want := map[string]bool{}
		for _, p := range PathParams(op.Path) {
			want[p] = true
		}
		got := map[string]bool{}
		for _, p := range op.Params {
			switch p.In {
			case InPath:
				got[p.Name] = true
				if !p.Required {
					t.Errorf("op %q: path param %q must be required", op.Name, p.Name)
				}
			case InQuery, InBody:
			default:
				t.Errorf("op %q: param %q has invalid location %q", op.Name, p.Name, p.In)
			}
			switch p.Type {
			case TypeString, TypeInteger, TypeBoolean, TypeIntArray, TypeBase64:
			default:
				t.Errorf("op %q: param %q has invalid type %q", op.Name, p.Name, p.Type)
			}
		}
		for name := range want {
			if !got[name] {
				t.Errorf("op %q: path placeholder %q has no param", op.Name, name)
			}
		}
		for name := range got {
			if !want[name] {
				t.Errorf("op %q: path param %q not in path %q", op.Name, name, op.Path)
			}
		}

		if op.Request == RequestMultipartImage {
			if len(bodyParams(op)) != 1 || bodyParams(op)[0].Type != TypeBase64 {
				t.Errorf("op %q: multipart-image ops need exactly one base64 body param", op.Name)
			}
		}
	}
}

func bodyParams(op Operation) []Param {
	var out []Param
	for _, p := range op.Params {
		if p.In == InBody {
			out = append(out, p)
		}
	}
	return out
}

func TestMCPOps_OnlyBearerReachable(t *testing.T) {
	for _, op := range MCPOps() {
		if !op.BearerReachable() {
			t.Errorf("op %q is not bearer-reachable but exposed to MCP", op.Name)
		}
		if op.MCPWaived != "" {
			t.Errorf("op %q is waived but returned by MCPOps", op.Name)
		}
	}
}

func TestMCPOps_EveryBearerOpAccountedFor(t *testing.T) {
	inMCP := map[string]bool{}
	for _, op := range MCPOps() {
		inMCP[op.Name] = true
	}
	for _, op := range Registry() {
		if op.BearerReachable() && !inMCP[op.Name] && op.MCPWaived == "" {
			t.Errorf("bearer-reachable op %q missing from MCP with no waiver", op.Name)
		}
	}
}
