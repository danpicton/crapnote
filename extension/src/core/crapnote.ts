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

	async listTags(): Promise<Tag[]> {
		return this.request('GET', '/api/tags');
	}

	async createTag(name: string): Promise<Tag> {
		return this.request('POST', '/api/tags', { name });
	}

	async attachTag(noteID: number, tagID: number): Promise<void> {
		await this.request('POST', `/api/notes/${noteID}/tags`, { tag_id: tagID });
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
