export interface User {
	id: number;
	username: string;
	is_admin: boolean;
	api_tokens_enabled?: boolean;
	created_at: string;
}

export interface VersionStatus {
	version: string;
	latest_version?: string;
	update_available: boolean;
}

export interface InviteResult {
	user: User & { pending_setup: boolean };
	setup_url: string;
	expires_at: string;
}

export interface ApiToken {
	id: number;
	name: string;
	prefix: string;
	scope: 'read' | 'read_write';
	last_used_at?: string;
	expires_at?: string;
	revoked_at?: string;
	created_at: string;
}

export interface CreatedApiToken extends ApiToken {
	token: string;
}

export interface Note {
	id: number;
	title: string;
	body: string;
	starred: boolean;
	pinned: boolean;
	archived: boolean;
	locked: boolean;
	/** Private notes remain available here but are hidden from MCP. */
	private?: boolean;
	/**
	 * Position among the user's pinned notes, ascending; always 0 when unpinned.
	 * Optional because notes built locally (offline creates, cached records
	 * written before this shipped) have no server-assigned position yet — the
	 * ordering helpers treat a missing value as 0.
	 */
	pin_order?: number;
	created_at: string;
	updated_at: string;
}

export interface Tag {
	id: number;
	name: string;
	note_count: number;
}

export interface TrashEntry {
	note_id: number;
	title: string;
	deleted_at: string;
	permanent_delete_at: string;
}

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

/**
 * Thrown when a request failed because the network is unreachable — either
 * fetch itself rejected (no service worker / hard network failure) or the
 * service worker answered with its synthetic offline 503, which it marks with
 * the `X-Crapnote-Offline: 1` header (see service-worker-strategies.ts). Callers use
 * this to distinguish "you are offline, fall back to the local cache" from a
 * genuine server error.
 */
export class OfflineError extends ApiError {
	constructor(message = 'offline') {
		super(503, message);
		this.name = 'OfflineError';
	}
}

/** Marker header set by the service worker on its synthetic offline 503s. */
const OFFLINE_HEADER = 'X-Crapnote-Offline';

/**
 * Deadline for the session check, and only for it.
 *
 * The root layout renders nothing until `/api/auth/me` settles, so a server
 * that accepts the connection and never answers — captive portal, wedged
 * backend, overloaded box — would otherwise hold the whole app blank until
 * the browser's own multi-minute network timeout. A server that does not
 * answer is, from here, indistinguishable from being offline, so the abort
 * surfaces as `OfflineError` and the app takes its offline path: the unlock
 * screen, or /login if this browser cannot prove ownership. Still fail-closed,
 * but on a screen the user can act on.
 *
 * Deliberately not applied to other calls: an export or an image upload is
 * legitimately slow, and cancelling those would be a bug, not a safeguard.
 */
export const SESSION_CHECK_TIMEOUT_MS = 10_000;

async function request<T>(
	method: string,
	path: string,
	body?: unknown,
	timeoutMs?: number,
	signal?: AbortSignal,
): Promise<T> {
	const headers: Record<string, string> = {};
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	// AbortController rather than AbortSignal.timeout: same effect, no
	// reliance on a newer API, and the timer is cleared below so a settled
	// request never fires a stray abort at an unrelated moment.
	const controller = timeoutMs !== undefined ? new AbortController() : undefined;
	const timer =
		controller !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

	let res: Response;
	try {
		res = await fetch(path, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
			credentials: 'include',
			signal: controller?.signal ?? signal,
		});
	} catch (error) {
		// An explicit caller cancellation is control flow, not an offline
		// failure. Preserve its AbortError so a superseded list load does not
		// mark the app offline.
		if (signal?.aborted) throw signal.reason ?? error;
		// fetch otherwise rejects only on network-level failure (offline, DNS,
		// CORS) or on our session-check timeout. Both mean the same thing to
		// callers: the server is not reachable.
		throw new OfflineError();
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}

	if (!res.ok) {
		const text = await res.text();
		if (res.headers.get(OFFLINE_HEADER) === '1') throw new OfflineError(text);
		throw new ApiError(res.status, text);
	}
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
	const entries = Object.entries(params).filter(([, v]) => v != null) as [string, string][];
	if (entries.length === 0) return '';
	return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

const PAGE_SIZE = 100;

async function requestAllPages<T>(
	path: string,
	params: Record<string, string | number | boolean | undefined> = {},
	signal?: AbortSignal,
): Promise<T[]> {
	const results: T[] = [];
	for (let offset = 0; ; offset += PAGE_SIZE) {
		signal?.throwIfAborted();
		const page = await request<T[]>(
			'GET',
			path + buildQuery({ ...params, limit: PAGE_SIZE, offset }),
			undefined,
			undefined,
			signal,
		);
		signal?.throwIfAborted();
		results.push(...page);
		if (page.length < PAGE_SIZE) return results;
	}
}

export const api = {
	version: {
		get: () => request<VersionStatus>('GET', '/api/version'),
	},

	auth: {
		login: (username: string, password: string) =>
			request<User>('POST', '/api/auth/login', { username, password }),
		logout: () => request<void>('POST', '/api/auth/logout'),
		me: () => request<User>('GET', '/api/auth/me', undefined, SESSION_CHECK_TIMEOUT_MS),
		changePassword: (newPassword: string) =>
			request<void>('POST', '/api/auth/password', { new_password: newPassword }),
	},

	notes: {
		list: (params?: { starred?: boolean; tag?: number; search?: string }, signal?: AbortSignal) =>
			requestAllPages<Note>('/api/notes', params, signal),
		create: (title?: string, body?: string) =>
			request<Note>('POST', '/api/notes', { title, body }),
		get: (id: number) => request<Note>('GET', `/api/notes/${id}`),
		update: (id: number, data: Partial<Pick<Note, 'title' | 'body' | 'private'>>) =>
			request<Note>('PUT', `/api/notes/${id}`, data),
		delete: (id: number) => request<void>('DELETE', `/api/notes/${id}`),
		toggleStar: (id: number) => request<Note>('PATCH', `/api/notes/${id}/star`),
		togglePin: (id: number) => request<Note>('PATCH', `/api/notes/${id}/pin`),
		/** Records the drag order of the caller's pinned notes, top first. */
		reorderPins: (ids: number[]) => request<void>('PUT', '/api/notes/pins/order', { ids }),
		toggleLock: (id: number) => request<Note>('PATCH', `/api/notes/${id}/lock`),
		archive: (id: number) => request<void>('PATCH', `/api/notes/${id}/archive`),
		unarchive: (id: number) => request<void>('PATCH', `/api/notes/${id}/unarchive`),
		listArchived: (params?: { search?: string }, signal?: AbortSignal) =>
			requestAllPages<Note>('/api/archive', params, signal),
	},

	tags: {
		list: () => requestAllPages<Tag>('/api/tags'),
		create: (name: string) => request<Tag>('POST', '/api/tags', { name }),
		rename: (id: number, name: string) => request<Tag>('PUT', `/api/tags/${id}`, { name }),
		delete: (id: number) => request<void>('DELETE', `/api/tags/${id}`),
		listForNote: (noteId: number) => request<Tag[]>('GET', `/api/notes/${noteId}/tags`),
		addToNote: (noteId: number, tagId: number) =>
			request<void>('POST', `/api/notes/${noteId}/tags`, { tag_id: tagId }),
		removeFromNote: (noteId: number, tagId: number) =>
			request<void>('DELETE', `/api/notes/${noteId}/tags/${tagId}`),
	},

	tokens: {
		list: () => request<ApiToken[]>('GET', '/api/tokens'),
		create: (name: string, scope: 'read' | 'read_write', ttlDays: number) =>
			request<CreatedApiToken>('POST', '/api/tokens', { name, scope, ttl_days: ttlDays }),
		revoke: (id: number) => request<void>('DELETE', `/api/tokens/${id}`),
		revokeAll: () => request<void>('POST', '/api/tokens/revoke-all'),
	},

	theme: {
		// Public — the login screen fetches this before any session exists.
		get: () => request<{ theme: string }>('GET', '/api/theme'),
		// Admin only — sets the default theme every client sees until a user
		// picks their own.
		setGlobal: (theme: string) => request<void>('PUT', '/api/admin/theme', { theme }),
	},

	admin: {
		setApiTokensEnabled: (userId: number, enabled: boolean) =>
			request<User>('PATCH', `/api/admin/users/${userId}/api-tokens`, { enabled }),
		setPassword: (userId: number, password: string) =>
			request<void>('PUT', `/api/admin/users/${userId}/password`, { password }),
		lockUser: (userId: number) =>
			request<User>('POST', `/api/admin/users/${userId}/lock`),
		unlockUser: (userId: number) =>
			request<User>('POST', `/api/admin/users/${userId}/unlock`),
		inviteUser: (username: string, isAdmin: boolean) =>
			request<InviteResult>('POST', '/api/admin/users/invite', {
				username,
				is_admin: isAdmin,
			}),
		regenerateInvite: (userId: number) =>
			request<InviteResult>('POST', `/api/admin/users/${userId}/invite`),
	},

	setup: {
		get: (token: string) =>
			request<{ username: string; expires_at: string }>('GET', `/api/setup/${encodeURIComponent(token)}`),
		complete: (token: string, password: string) =>
			request<void>('POST', `/api/setup/${encodeURIComponent(token)}`, { password }),
	},

	trash: {
		list: (params?: { search?: string }, signal?: AbortSignal) =>
			requestAllPages<TrashEntry>('/api/trash', params, signal),
		restore: (id: number) => request<void>('POST', `/api/trash/${id}/restore`),
		deleteOne: (id: number) => request<void>('DELETE', `/api/trash/${id}`),
		empty: () => request<void>('DELETE', '/api/trash'),
	},

	export: async (password?: string) => {
		const res = await fetch('/api/export', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password: password ?? null }),
			credentials: 'include',
		});
		if (!res.ok) throw new ApiError(res.status, await res.text());
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `crapnote-export-${new Date().toISOString().slice(0, 10)}.zip`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	},
};
