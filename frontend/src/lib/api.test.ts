import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, ApiError } from './api';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(data: unknown, status = 200) {
	return { ok: true, status, json: () => Promise.resolve(data), text: () => Promise.resolve('') };
}
function fail(status: number, body = 'error') {
	return { ok: false, status, json: () => Promise.reject(new Error()), text: () => Promise.resolve(body) };
}

beforeEach(() => mockFetch.mockReset());

describe('api.auth', () => {
	it('login: POST /api/auth/login, returns user', async () => {
		const user = { id: 1, username: 'alice', is_admin: false, created_at: '2024-01-01T00:00:00Z' };
		mockFetch.mockResolvedValueOnce(ok(user));
		const result = await api.auth.login('alice', 'pass');
		expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
			method: 'POST',
			body: JSON.stringify({ username: 'alice', password: 'pass' }),
		}));
		expect(result).toEqual(user);
	});

	it('login: throws ApiError on 401', async () => {
		mockFetch.mockResolvedValueOnce(fail(401, '{"error":"invalid credentials"}'));
		await expect(api.auth.login('alice', 'wrong')).rejects.toBeInstanceOf(ApiError);
	});

	it('me: GET /api/auth/me', async () => {
		const user = { id: 1, username: 'alice', is_admin: false, created_at: '2024-01-01T00:00:00Z' };
		mockFetch.mockResolvedValueOnce(ok(user));
		const result = await api.auth.me();
		expect(mockFetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ method: 'GET' }));
		expect(result).toEqual(user);
	});

	it('logout: POST /api/auth/logout', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(null), text: () => Promise.resolve('') });
		await api.auth.logout();
		expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
	});
});

describe('api.notes', () => {
	const note = { id: 1, title: 'T', body: 'B', starred: false, pinned: false, archived: false, created_at: '', updated_at: '' };

	it('list: GET /api/notes', async () => {
		mockFetch.mockResolvedValueOnce(ok([note]));
		const result = await api.notes.list();
		const url = mockFetch.mock.calls[0][0] as string;
		expect(url).toMatch(/^\/api\/notes\?/);
		expect(url).toContain('limit=100');
		expect(mockFetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'GET' }));
		expect(result).toHaveLength(1);
	});

	it('list: includes search param', async () => {
		mockFetch.mockResolvedValueOnce(ok([]));
		await api.notes.list({ search: 'hello' });
		const url = mockFetch.mock.calls[0][0] as string;
		expect(url).toContain('search=hello');
	});

	it('create: POST /api/notes', async () => {
		mockFetch.mockResolvedValueOnce(ok(note));
		await api.notes.create('T', 'B');
		expect(mockFetch).toHaveBeenCalledWith('/api/notes', expect.objectContaining({
			method: 'POST',
			body: JSON.stringify({ title: 'T', body: 'B' }),
		}));
	});

	it('update: PUT /api/notes/:id', async () => {
		mockFetch.mockResolvedValueOnce(ok(note));
		await api.notes.update(1, { body: 'new body' });
		expect(mockFetch).toHaveBeenCalledWith('/api/notes/1', expect.objectContaining({
			method: 'PUT',
			body: JSON.stringify({ body: 'new body' }),
		}));
	});

	it('delete: DELETE /api/notes/:id', async () => {
		mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(null), text: () => Promise.resolve('') });
		await api.notes.delete(1);
		expect(mockFetch).toHaveBeenCalledWith('/api/notes/1', expect.objectContaining({ method: 'DELETE' }));
	});

	it('toggleStar: PATCH /api/notes/:id/star', async () => {
		mockFetch.mockResolvedValueOnce(ok({ ...note, starred: true }));
		const result = await api.notes.toggleStar(1);
		expect(result.starred).toBe(true);
	});
});

describe('ApiError', () => {
	it('has status and message', () => {
		const err = new ApiError(404, 'not found');
		expect(err.status).toBe(404);
		expect(err.message).toBe('not found');
		expect(err).toBeInstanceOf(Error);
	});
});
