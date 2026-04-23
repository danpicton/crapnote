export interface User {
	id: number;
	username: string;
	is_admin: boolean;
	api_tokens_enabled?: boolean;
	created_at: string;
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	const headers: Record<string, string> = {};
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	const res = await fetch(path, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
		credentials: 'include',
	});

	if (!res.ok) {
		const text = await res.text();
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

export const api = {
	auth: {
		login: (username: string, password: string) =>
			request<User>('POST', '/api/auth/login', { username, password }),
		logout: () => request<void>('POST', '/api/auth/logout'),
		me: () => request<User>('GET', '/api/auth/me'),
	},

	notes: {
		list: (params?: { starred?: boolean; tag_id?: number; search?: string }) =>
			request<Note[]>(
				'GET',
				'/api/notes' + buildQuery({ limit: 100, ...(params ?? {}) }),
			),
		create: (title?: string, body?: string) =>
			request<Note>('POST', '/api/notes', { title, body }),
		get: (id: number) => request<Note>('GET', `/api/notes/${id}`),
		update: (id: number, data: Partial<Pick<Note, 'title' | 'body'>>) =>
			request<Note>('PUT', `/api/notes/${id}`, data),
		delete: (id: number) => request<void>('DELETE', `/api/notes/${id}`),
		toggleStar: (id: number) => request<Note>('PATCH', `/api/notes/${id}/star`),
		togglePin: (id: number) => request<Note>('PATCH', `/api/notes/${id}/pin`),
		archive: (id: number) => request<void>('PATCH', `/api/notes/${id}/archive`),
		unarchive: (id: number) => request<void>('PATCH', `/api/notes/${id}/unarchive`),
		listArchived: () => request<Note[]>('GET', '/api/archive?limit=100'),
	},

	tags: {
		list: () => request<Tag[]>('GET', '/api/tags?limit=100'),
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

	admin: {
		setApiTokensEnabled: (userId: number, enabled: boolean) =>
			request<User>('PATCH', `/api/admin/users/${userId}/api-tokens`, { enabled }),
		setPassword: (userId: number, password: string) =>
			request<void>('PUT', `/api/admin/users/${userId}/password`, { password }),
		lockUser: (userId: number) =>
			request<User>('POST', `/api/admin/users/${userId}/lock`),
		unlockUser: (userId: number) =>
			request<User>('POST', `/api/admin/users/${userId}/unlock`),
	},

	trash: {
		list: () => request<TrashEntry[]>('GET', '/api/trash?limit=100'),
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
