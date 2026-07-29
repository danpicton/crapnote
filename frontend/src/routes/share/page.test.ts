import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api', () => ({
	api: {
		notes: { create: vi.fn() },
		auth: { me: vi.fn() },
	},
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// The share sheet lands here with the shared fields in the query string; each
// test rewrites this before rendering.
let shareUrl = new URL('http://localhost/share');
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: {
			subscribe: (run: (v: unknown) => void) =>
				readable({ url: shareUrl, params: {}, route: { id: '/share' }, data: {} }).subscribe(run),
		},
		navigating: readable(null),
	};
});

const authState = { user: null as { id: number } | null };
vi.mock('$lib/stores/auth.svelte', () => ({
	auth: {
		get user() {
			return authState.user;
		},
		init: vi.fn(),
	},
}));

import SharePage from './+page.svelte';
import { api } from '$lib/api';
import { goto } from '$app/navigation';
import { PENDING_SHARE_KEY } from '$lib/share';

const note = (id = 7) => ({
	id,
	title: 'Shared',
	body: '',
	starred: false,
	pinned: false,
	archived: false,
	locked: false,
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
});

beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
	shareUrl = new URL('http://localhost/share');
	authState.user = { id: 1 };
	vi.mocked(api.notes.create).mockResolvedValue(note());
});

describe('/share', () => {
	it('creates a note from the shared fields and opens it', async () => {
		shareUrl = new URL('http://localhost/share?title=Post&text=A+quote&url=https%3A%2F%2Fexample.com');

		render(SharePage);

		await waitFor(() =>
			expect(api.notes.create).toHaveBeenCalledWith('Post', 'A quote\n\nhttps://example.com')
		);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/notes/7', { replaceState: true }));
	});

	it('sends an empty title through so the server applies its default', async () => {
		shareUrl = new URL('http://localhost/share?text=no+title+here');

		render(SharePage);

		await waitFor(() => expect(api.notes.create).toHaveBeenCalledWith('', 'no title here'));
	});

	it('goes home without creating anything when the share is empty', async () => {
		render(SharePage);

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/', { replaceState: true }));
		expect(api.notes.create).not.toHaveBeenCalled();
	});

	it('stashes the share and redirects to login when signed out', async () => {
		authState.user = null;
		shareUrl = new URL('http://localhost/share?text=keep+me');

		render(SharePage);

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login', { replaceState: true }));
		expect(api.notes.create).not.toHaveBeenCalled();
		expect(JSON.parse(sessionStorage.getItem(PENDING_SHARE_KEY)!)).toMatchObject({
			text: 'keep me',
		});
	});

	it('completes a stashed share after login', async () => {
		sessionStorage.setItem(PENDING_SHARE_KEY, JSON.stringify({ text: 'from before login' }));
		shareUrl = new URL('http://localhost/share?restore=1');

		render(SharePage);

		await waitFor(() => expect(api.notes.create).toHaveBeenCalledWith('', 'from before login'));
		expect(sessionStorage.getItem(PENDING_SHARE_KEY)).toBeNull();
	});

	it('reports a failure instead of losing the share', async () => {
		shareUrl = new URL('http://localhost/share?text=important');
		vi.mocked(api.notes.create).mockRejectedValue(new Error('offline'));

		render(SharePage);

		await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeTruthy());
		expect(screen.getByText(/try again/i)).toBeTruthy();
		// The payload is kept so the retry has something to send.
		expect(sessionStorage.getItem(PENDING_SHARE_KEY)).not.toBeNull();
	});
});
