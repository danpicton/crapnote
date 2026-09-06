// Package apispec is the single source of truth for the CrapNote API
// surface. Every /api route the server exposes is described here as an
// Operation; the HTTP mux registers its routes from this registry, the MCP
// server generates its tools from it, and the CLI's parity test checks its
// command coverage against the JSON contract generated from it
// (docs/api-contract.json). Adding an endpoint therefore starts here — a
// route that isn't in the registry cannot be registered, and a registry op
// with no handler binding fails mux construction.
package apispec

import (
	"fmt"
	"strings"

	"github.com/danpicton/crapnote/internal/httpx"
)

// Scope classifies who may call an operation.
type Scope string

const (
	// ScopePublic operations require no authentication.
	ScopePublic Scope = "public"
	// ScopeRead operations require auth; read-only bearer tokens suffice.
	ScopeRead Scope = "read"
	// ScopeWrite operations require auth and a read_write bearer token
	// (cookie sessions always pass).
	ScopeWrite Scope = "write"
)

// ParamIn says where a parameter travels in the HTTP request.
type ParamIn string

const (
	InPath  ParamIn = "path"
	InQuery ParamIn = "query"
	InBody  ParamIn = "body"
)

// ParamType is the JSON-schema-ish type of a parameter.
type ParamType string

const (
	TypeString   ParamType = "string"
	TypeInteger  ParamType = "integer"
	TypeBoolean  ParamType = "boolean"
	TypeIntArray ParamType = "array:integer"
	// TypeBase64 is binary content supplied as a base64 string (uploads).
	TypeBase64 ParamType = "base64"
)

// RequestKind says how body params are encoded on the wire.
type RequestKind string

const (
	RequestJSON RequestKind = "json"
	// RequestMultipartImage sends the single base64 body param as a
	// multipart form file field named "image".
	RequestMultipartImage RequestKind = "multipart-image"
)

// ResponseKind is a coarse hint for clients that must re-encode the
// response (the MCP server): JSON passes through as text, binary responses
// are base64-encoded, images become image content.
type ResponseKind string

const (
	ResponseJSON   ResponseKind = "json"
	ResponseNone   ResponseKind = "none"
	ResponseBinary ResponseKind = "binary"
	ResponseImage  ResponseKind = "image"
)

// Param describes one input to an operation.
type Param struct {
	Name        string    `json:"name"`
	In          ParamIn   `json:"in"`
	Type        ParamType `json:"type"`
	Required    bool      `json:"required"`
	Description string    `json:"description"`
}

// Operation describes one API endpoint.
type Operation struct {
	// Name uniquely identifies the operation; it is also the MCP tool name.
	Name   string `json:"name"`
	Method string `json:"method"`
	// Path is the mux pattern without the method, e.g. "/api/notes/{id}".
	Path  string `json:"path"`
	Scope Scope  `json:"scope"`
	// AdminOnly operations require an admin user AND a cookie session:
	// auth.RequireAdmin rejects bearer tokens by design.
	AdminOnly bool `json:"admin_only"`
	// CookieOnly operations reject bearer-authenticated requests
	// (cookieOnly in cmd/server) so a leaked token cannot escalate.
	CookieOnly bool `json:"cookie_only"`
	// LoginRateLimited public operations sit behind the login limiter.
	LoginRateLimited bool         `json:"login_rate_limited,omitempty"`
	Description      string       `json:"description"`
	Params           []Param      `json:"params,omitempty"`
	Request          RequestKind  `json:"request"`
	Response         ResponseKind `json:"response"`
	// MCPWaived, when non-empty, explains why no MCP tool is generated for
	// an otherwise bearer-reachable operation.
	MCPWaived string `json:"mcp_waived,omitempty"`
	// Destructive marks operations that irreversibly destroy data. The MCP
	// server surfaces this as the tool's destructiveHint annotation so
	// agent clients can require user confirmation before calling.
	Destructive bool `json:"destructive,omitempty"`
}

// BearerReachable reports whether the operation can be called with an API
// token — i.e. whether it is part of the MCP-eligible surface.
func (o Operation) BearerReachable() bool {
	return o.Scope != ScopePublic && !o.AdminOnly && !o.CookieOnly
}

func pageParams() []Param {
	// Read the numbers from httpx rather than restating them: ParsePage
	// clamps silently, so a description that promises more than the server
	// returns is published to every MCP client and CLI user as fact.
	return []Param{
		{Name: "limit", In: InQuery, Type: TypeInteger, Description: fmt.Sprintf("Max results per page (default %d, max %d).", httpx.DefaultPageSize, httpx.MaxPageSize)},
		{Name: "offset", In: InQuery, Type: TypeInteger, Description: "Number of results to skip."},
	}
}

func noteID() Param {
	return Param{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "Note ID."}
}

// Registry returns every /api operation the server exposes. Order is
// stable; treat it as append-mostly so the JSON contract diffs cleanly.
func Registry() []Operation {
	ops := []Operation{
		// ── Public ──────────────────────────────────────────────────────
		{
			Name: "health", Method: "GET", Path: "/api/health", Scope: ScopePublic,
			Description: "Health check.",
		},
		{
			Name: "theme_get", Method: "GET", Path: "/api/theme", Scope: ScopePublic,
			Description: "Get the global theme (public so the login screen can render it).",
		},
		{
			Name: "auth_login", Method: "POST", Path: "/api/auth/login", Scope: ScopePublic,
			LoginRateLimited: true,
			Description:      "Log in with username and password; sets a session cookie.",
			Params: []Param{
				{Name: "username", In: InBody, Type: TypeString, Required: true},
				{Name: "password", In: InBody, Type: TypeString, Required: true},
			},
		},
		{
			Name: "setup_get", Method: "GET", Path: "/api/setup/{token}", Scope: ScopePublic,
			LoginRateLimited: true,
			Description:      "Look up a pending account-setup invite by its token.",
			Params: []Param{
				{Name: "token", In: InPath, Type: TypeString, Required: true, Description: "Setup invite token."},
			},
		},
		{
			Name: "setup_complete", Method: "POST", Path: "/api/setup/{token}", Scope: ScopePublic,
			LoginRateLimited: true,
			Description:      "Complete account setup by choosing a password.",
			Params: []Param{
				{Name: "token", In: InPath, Type: TypeString, Required: true, Description: "Setup invite token."},
				{Name: "password", In: InBody, Type: TypeString, Required: true},
			},
		},

		// ── Auth (session/user) ─────────────────────────────────────────
		{
			Name: "auth_logout", Method: "POST", Path: "/api/auth/logout", Scope: ScopeRead,
			Description: "End the current browser session.",
			Response:    ResponseNone,
			MCPWaived:   "logout ends a cookie session; bearer tokens have no session to end",
		},
		{
			Name: "auth_me", Method: "GET", Path: "/api/auth/me", Scope: ScopeRead,
			Description: "Return the authenticated user (id, username, admin flag).",
		},
		{
			Name: "auth_change_password", Method: "POST", Path: "/api/auth/password", Scope: ScopeRead,
			CookieOnly:  true,
			Description: "Change your own password (cookie sessions only — a leaked token must not hijack the account).",
			Params: []Param{
				{Name: "new_password", In: InBody, Type: TypeString, Required: true},
			},
		},

		// ── API tokens ──────────────────────────────────────────────────
		{
			Name: "tokens_list", Method: "GET", Path: "/api/tokens", Scope: ScopeRead,
			Description: "List your API tokens (metadata only, never raw secrets).",
		},
		{
			Name: "tokens_create", Method: "POST", Path: "/api/tokens", Scope: ScopeWrite,
			CookieOnly:  true,
			Description: "Create an API token (cookie sessions only — tokens cannot mint tokens).",
			Params: []Param{
				{Name: "name", In: InBody, Type: TypeString, Required: true},
				{Name: "scope", In: InBody, Type: TypeString, Required: true, Description: "\"read\" or \"read_write\"."},
				{Name: "ttl_days", In: InBody, Type: TypeInteger, Description: "Days until expiry; 0/omitted = default (90), -1 = no expiry."},
			},
		},
		{
			Name: "tokens_revoke", Method: "DELETE", Path: "/api/tokens/{id}", Scope: ScopeWrite,
			Destructive: true,
			Description: "Revoke one of your API tokens.",
			Response:    ResponseNone,
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "Token ID."},
			},
		},
		{
			Name: "tokens_revoke_all", Method: "POST", Path: "/api/tokens/revoke-all", Scope: ScopeWrite,
			Destructive: true,
			Description: "Revoke all of your API tokens. Irreversible; this also revokes the token making the call.",
			Response:    ResponseNone,
		},

		// ── Notes ───────────────────────────────────────────────────────
		{
			Name: "notes_list", Method: "GET", Path: "/api/notes", Scope: ScopeRead,
			Description: "List your notes, optionally filtered. Use the search param for full-text (FTS5) search.",
			Params: append([]Param{
				{Name: "starred", In: InQuery, Type: TypeBoolean, Description: "Filter by starred flag: true returns only starred notes, false only unstarred. Omit for all notes."},
				{Name: "tag", In: InQuery, Type: TypeInteger, Description: "Only notes carrying this tag ID. Omit, or pass 0, for notes with any or no tag."},
				{Name: "search", In: InQuery, Type: TypeString, Description: "Full-text search query."},
			}, pageParams()...),
		},
		{
			Name: "notes_create", Method: "POST", Path: "/api/notes", Scope: ScopeWrite,
			Description: "Create a note (markdown body).",
			Params: []Param{
				{Name: "title", In: InBody, Type: TypeString, Required: true, Description: "Title, max 500 chars."},
				{Name: "body", In: InBody, Type: TypeString, Description: "Markdown body, max 500k chars."},
			},
		},
		{
			Name: "notes_get", Method: "GET", Path: "/api/notes/{id}", Scope: ScopeRead,
			Description: "Fetch a single note.",
			Params:      []Param{noteID()},
		},
		{
			Name: "notes_update", Method: "PUT", Path: "/api/notes/{id}", Scope: ScopeWrite,
			Description: "Update a note's title and/or body. Omitted fields are left unchanged. Fails with 423 if the note is locked.",
			Params: []Param{
				noteID(),
				{Name: "title", In: InBody, Type: TypeString, Description: "New title, max 500 chars."},
				{Name: "body", In: InBody, Type: TypeString, Description: "New markdown body, max 500k chars."},
			},
		},
		{
			Name: "notes_delete", Method: "DELETE", Path: "/api/notes/{id}", Scope: ScopeWrite,
			Description: "Move a note to the trash (recoverable for 7 days). Fails with 423 if locked.",
			Response:    ResponseNone,
			Params:      []Param{noteID()},
		},
		{
			Name: "notes_toggle_star", Method: "PATCH", Path: "/api/notes/{id}/star", Scope: ScopeWrite,
			Description: "Toggle a note's starred flag; returns the updated note.",
			Params:      []Param{noteID()},
		},
		{
			Name: "notes_toggle_pin", Method: "PATCH", Path: "/api/notes/{id}/pin", Scope: ScopeWrite,
			Description: "Toggle a note's pinned flag; returns the updated note.",
			Params:      []Param{noteID()},
		},
		{
			Name: "notes_toggle_lock", Method: "PATCH", Path: "/api/notes/{id}/lock", Scope: ScopeWrite,
			Description: "Toggle a note's locked flag (locked notes refuse edits and deletion); returns the updated note.",
			Params:      []Param{noteID()},
		},
		{
			Name: "notes_reorder_pins", Method: "PUT", Path: "/api/notes/pins/order", Scope: ScopeWrite,
			Description: "Set the display order of your pinned notes.",
			Response:    ResponseNone,
			Params: []Param{
				{Name: "ids", In: InBody, Type: TypeIntArray, Required: true, Description: "Pinned note IDs, top first."},
			},
		},
		{
			Name: "notes_archive", Method: "PATCH", Path: "/api/notes/{id}/archive", Scope: ScopeWrite,
			Description: "Archive a note (hidden from the main list).",
			Response:    ResponseNone,
			Params:      []Param{noteID()},
		},
		{
			Name: "notes_unarchive", Method: "PATCH", Path: "/api/notes/{id}/unarchive", Scope: ScopeWrite,
			Description: "Restore a note from the archive.",
			Response:    ResponseNone,
			Params:      []Param{noteID()},
		},
		{
			Name: "archive_list", Method: "GET", Path: "/api/archive", Scope: ScopeRead,
			Description: "List your archived notes.",
			Params:      pageParams(),
		},

		// ── Note–tag associations ───────────────────────────────────────
		{
			Name: "note_tags_list", Method: "GET", Path: "/api/notes/{id}/tags", Scope: ScopeRead,
			Description: "List the tags on a note.",
			Params:      []Param{noteID()},
		},
		{
			Name: "note_tags_add", Method: "POST", Path: "/api/notes/{id}/tags", Scope: ScopeWrite,
			Description: "Attach an existing tag to a note.",
			Response:    ResponseNone,
			Params: []Param{
				noteID(),
				{Name: "tag_id", In: InBody, Type: TypeInteger, Required: true, Description: "Tag ID to attach."},
			},
		},
		{
			Name: "note_tags_remove", Method: "DELETE", Path: "/api/notes/{id}/tags/{tid}", Scope: ScopeWrite,
			Description: "Detach a tag from a note.",
			Response:    ResponseNone,
			Params: []Param{
				noteID(),
				{Name: "tid", In: InPath, Type: TypeInteger, Required: true, Description: "Tag ID to detach."},
			},
		},

		// ── Tags ────────────────────────────────────────────────────────
		{
			Name: "tags_list", Method: "GET", Path: "/api/tags", Scope: ScopeRead,
			Description: "List your tags with note counts.",
			Params:      pageParams(),
		},
		{
			Name: "tags_create", Method: "POST", Path: "/api/tags", Scope: ScopeWrite,
			Description: "Create a tag.",
			Params: []Param{
				{Name: "name", In: InBody, Type: TypeString, Required: true, Description: "Tag name, max 100 chars."},
			},
		},
		{
			Name: "tags_rename", Method: "PUT", Path: "/api/tags/{id}", Scope: ScopeWrite,
			Description: "Rename a tag.",
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "Tag ID."},
				{Name: "name", In: InBody, Type: TypeString, Required: true, Description: "New name, max 100 chars."},
			},
		},
		{
			Name: "tags_delete", Method: "DELETE", Path: "/api/tags/{id}", Scope: ScopeWrite,
			Destructive: true,
			Description: "Delete a tag (notes keep their other tags).",
			Response:    ResponseNone,
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "Tag ID."},
			},
		},

		// ── Export ──────────────────────────────────────────────────────
		{
			Name: "export", Method: "POST", Path: "/api/export", Scope: ScopeRead,
			Description: "Export all non-trashed notes as a ZIP of markdown files with bundled images. Optionally password-encrypted.",
			Response:    ResponseBinary,
			Params: []Param{
				{Name: "password", In: InBody, Type: TypeString, Description: "Optional password to encrypt the ZIP."},
			},
		},

		// ── Images ──────────────────────────────────────────────────────
		{
			Name: "images_upload", Method: "POST", Path: "/api/images", Scope: ScopeWrite,
			Description: "Upload an image (PNG/JPEG/GIF/WebP); returns its URL for embedding in note markdown.",
			Request:     RequestMultipartImage,
			Params: []Param{
				{Name: "image", In: InBody, Type: TypeBase64, Required: true, Description: "Image bytes, base64-encoded."},
			},
		},
		{
			Name: "images_get", Method: "GET", Path: "/api/images/{id}", Scope: ScopeRead,
			Description: "Fetch one of your images.",
			Response:    ResponseImage,
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeString, Required: true, Description: "Image ID (the last path segment of an image URL)."},
			},
		},

		// ── Trash ───────────────────────────────────────────────────────
		{
			Name: "trash_list", Method: "GET", Path: "/api/trash", Scope: ScopeRead,
			Description: "List trashed notes and when each will be permanently deleted.",
			Params:      pageParams(),
		},
		{
			Name: "trash_restore", Method: "POST", Path: "/api/trash/{id}/restore", Scope: ScopeWrite,
			Description: "Restore a note from the trash.",
			Response:    ResponseNone,
			Params:      []Param{noteID()},
		},
		{
			Name: "trash_delete", Method: "DELETE", Path: "/api/trash/{id}", Scope: ScopeWrite,
			Destructive: true,
			Description: "Permanently delete one trashed note. Irreversible.",
			Response:    ResponseNone,
			Params:      []Param{noteID()},
		},
		{
			Name: "trash_empty", Method: "DELETE", Path: "/api/trash", Scope: ScopeWrite,
			Destructive: true,
			Description: "Permanently delete everything in the trash. Irreversible.",
			Response:    ResponseNone,
		},

		// ── Admin (cookie sessions only — bearer tokens are rejected) ───
		{
			Name: "admin_users_list", Method: "GET", Path: "/api/admin/users", Scope: ScopeRead, AdminOnly: true,
			Description: "List all users.",
		},
		{
			Name: "admin_users_create", Method: "POST", Path: "/api/admin/users", Scope: ScopeWrite, AdminOnly: true,
			Description: "Create a user with a password.",
			Params: []Param{
				{Name: "username", In: InBody, Type: TypeString, Required: true},
				{Name: "password", In: InBody, Type: TypeString, Required: true},
				{Name: "is_admin", In: InBody, Type: TypeBoolean},
			},
		},
		{
			Name: "admin_users_delete", Method: "DELETE", Path: "/api/admin/users/{id}", Scope: ScopeWrite, AdminOnly: true,
			Description: "Delete a user and their data.",
			Response:    ResponseNone,
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "User ID."},
			},
		},
		{
			Name: "admin_user_api_tokens", Method: "PATCH", Path: "/api/admin/users/{id}/api-tokens", Scope: ScopeWrite, AdminOnly: true,
			Description: "Enable or disable API tokens for a user.",
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "User ID."},
				{Name: "enabled", In: InBody, Type: TypeBoolean, Required: true},
			},
		},
		{
			Name: "admin_user_set_password", Method: "PUT", Path: "/api/admin/users/{id}/password", Scope: ScopeWrite, AdminOnly: true,
			Description: "Set a user's password.",
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "User ID."},
				{Name: "password", In: InBody, Type: TypeString, Required: true},
			},
		},
		{
			Name: "admin_user_lock", Method: "POST", Path: "/api/admin/users/{id}/lock", Scope: ScopeWrite, AdminOnly: true,
			Description: "Lock a user account.",
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "User ID."},
			},
		},
		{
			Name: "admin_user_unlock", Method: "POST", Path: "/api/admin/users/{id}/unlock", Scope: ScopeWrite, AdminOnly: true,
			Description: "Unlock a user account.",
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "User ID."},
			},
		},
		{
			Name: "admin_user_clear_cooldowns", Method: "POST", Path: "/api/admin/users/{id}/clear-cooldowns", Scope: ScopeWrite, AdminOnly: true,
			Description: "Clear the automatic failed-login cool-downs held against a user, leaving any admin lock in place.",
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "User ID."},
			},
		},
		{
			Name: "admin_users_invite", Method: "POST", Path: "/api/admin/users/invite", Scope: ScopeWrite, AdminOnly: true,
			Description: "Invite a user; returns a one-time setup link.",
			Params: []Param{
				{Name: "username", In: InBody, Type: TypeString, Required: true},
				{Name: "is_admin", In: InBody, Type: TypeBoolean},
			},
		},
		{
			Name: "admin_user_regenerate_invite", Method: "POST", Path: "/api/admin/users/{id}/invite", Scope: ScopeWrite, AdminOnly: true,
			Description: "Regenerate a pending user's setup link.",
			Params: []Param{
				{Name: "id", In: InPath, Type: TypeInteger, Required: true, Description: "User ID."},
			},
		},
		{
			Name: "admin_theme_set", Method: "PUT", Path: "/api/admin/theme", Scope: ScopeWrite, AdminOnly: true,
			Description: "Set the global theme.",
			Params: []Param{
				{Name: "theme", In: InBody, Type: TypeString, Required: true},
			},
		},
	}

	for i := range ops {
		if ops[i].Request == "" {
			ops[i].Request = RequestJSON
		}
		if ops[i].Response == "" {
			ops[i].Response = ResponseJSON
		}
	}
	return ops
}

// MCPOps returns the operations the MCP server exposes as tools:
// bearer-reachable and not explicitly waived.
func MCPOps() []Operation {
	var out []Operation
	for _, op := range Registry() {
		if op.BearerReachable() && op.MCPWaived == "" {
			out = append(out, op)
		}
	}
	return out
}

// PathParams extracts the {placeholder} names from a mux path pattern.
func PathParams(path string) []string {
	var out []string
	for _, seg := range strings.Split(path, "/") {
		if strings.HasPrefix(seg, "{") && strings.HasSuffix(seg, "}") {
			out = append(out, strings.Trim(seg, "{}"))
		}
	}
	return out
}
