// HTTP client for the CrapNote REST API, authenticated with a bearer API
// token. `fetch` is injected so tests never touch the network.
export interface CrapNoteConfig {
	serverUrl: string;
	apiToken: string;
}

export interface Note {
	id: number;
	title: string;
	body: string;
}

export interface Tag {
	id: number;
	name: string;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class CrapNoteClient {
	constructor(
		private config: CrapNoteConfig,
		private fetch: Fetch = globalThis.fetch.bind(globalThis),
	) {}

	async createNote(title: string, body: string): Promise<Note> {
		return this.request('POST', '/api/notes', { title, body });
	}

	// The server caps list pages at 100 items, so page until a short page.
	async listTags(): Promise<Tag[]> {
		const pageSize = 100;
		const all: Tag[] = [];
		for (let offset = 0; ; offset += pageSize) {
			const page: Tag[] = await this.request(
				'GET',
				`/api/tags?limit=${pageSize}&offset=${offset}`,
			);
			all.push(...page);
			if (page.length < pageSize) return all;
		}
	}

	async createTag(name: string): Promise<Tag> {
		return this.request('POST', '/api/tags', { name });
	}

	async attachTag(noteID: number, tagID: number): Promise<void> {
		await this.request('POST', `/api/notes/${noteID}/tags`, { tag_id: tagID });
	}

	// Uploads an image blob; returns the note-embeddable URL
	// (e.g. /api/images/{id}).
	async uploadImage(blob: Blob): Promise<string> {
		const form = new FormData();
		form.append('image', blob);
		const res = await this.fetch(`${this.config.serverUrl}/api/images`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${this.config.apiToken}` },
			body: form,
		});
		if (!res.ok) {
			throw new Error(`CrapNote API POST /api/images failed: ${res.status}`);
		}
		const { url } = (await res.json()) as { url: string };
		return url;
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await this.fetch(`${this.config.serverUrl}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${this.config.apiToken}`,
				...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});
		if (!res.ok) {
			throw new Error(`CrapNote API ${method} ${path} failed: ${res.status}`);
		}
		if (res.status === 204) return undefined as T;
		return (await res.json()) as T;
	}
}
