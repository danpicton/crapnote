export interface User {
	id: number;
	username: string;
	is_admin: boolean;
	created_at: string;
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
			request<Note[]>('GET', '/api/notes' + (params ? buildQuery(params as Record<string, string>) : '')),
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
		listArchived: () => request<Note[]>('GET', '/api/archive'),
	},

	tags: {
		list: () => request<Tag[]>('GET', '/api/tags'),
		create: (name: string) => request<Tag>('POST', '/api/tags', { name }),
		rename: (id: number, name: string) => request<Tag>('PUT', `/api/tags/${id}`, { name }),
		delete: (id: number) => request<void>('DELETE', `/api/tags/${id}`),
		listForNote: (noteId: number) => request<Tag[]>('GET', `/api/notes/${noteId}/tags`),
		addToNote: (noteId: number, tagId: number) =>
			request<void>('POST', `/api/notes/${noteId}/tags`, { tag_id: tagId }),
		removeFromNote: (noteId: number, tagId: number) =>
			request<void>('DELETE', `/api/notes/${noteId}/tags/${tagId}`),
	},

	trash: {
		list: () => request<TrashEntry[]>('GET', '/api/trash'),
		restore: (id: number) => request<void>('POST', `/api/trash/${id}/restore`),
		deleteOne: (id: number) => request<void>('DELETE', `/api/trash/${id}`),
		empty: () => request<void>('DELETE', '/api/trash'),
	},

	export: (password?: string) => {
		const url = '/api/export' + (password ? `?password=${encodeURIComponent(password)}` : '');
		window.location.href = url;
	},
};
