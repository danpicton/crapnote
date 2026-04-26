import { render } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Snippet } from 'svelte';
import Layout from './+layout.svelte';
import { writable } from 'svelte/store';

// Svelte 5 Snippet is a branded type — cast a no-op fn for tests that only
// exercise redirect logic and never actually render children.
const noopSnippet = (() => {}) as unknown as Snippet;

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));

const pageStore = writable({
	url: new URL('http://localhost/'),
	params: {}, route: { id: null }, status: 200,
	error: null, data: {}, form: undefined, state: {},
});

vi.mock('$app/stores', () => ({
	page: { subscribe: (fn: Parameters<ReturnType<typeof writable>['subscribe']>[0]) => pageStore.subscribe(fn) },
	navigating: { subscribe: () => () => {} },
	updated: { subscribe: () => () => {} },
}));

const mockAuth = vi.hoisted(() => ({ user: null as object | null, loading: false, init: vi.fn() }));
vi.mock('$lib/stores/auth.svelte', () => ({ auth: mockAuth }));

vi.mock('$lib/stores/theme.svelte', () => ({ theme: { init: vi.fn(), current: 'light', toggle: vi.fn() } }));
vi.mock('$lib/sw-register', () => ({ registerSW: vi.fn() }));

function setPath(pathname: string) {
	pageStore.set({
		url: new URL(`http://localhost${pathname}`),
		params: {}, route: { id: null }, status: 200,
		error: null, data: {}, form: undefined, state: {},
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockAuth.user = null;
	mockAuth.init.mockResolvedValue(undefined);
	setPath('/');
});

describe('Layout auth guard', () => {
	it('redirects unauthenticated users from protected routes to login', async () => {
		setPath('/');
		render(Layout, { children: noopSnippet });
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/login', { replaceState: true }));
	});

	it('does not redirect unauthenticated users on /login', async () => {
		setPath('/login');
		render(Layout, { children: noopSnippet });
		// Wait for onMount to run
		await new Promise(r => setTimeout(r, 50));
		expect(goto).not.toHaveBeenCalledWith('/login', { replaceState: true });
	});

	it('does not redirect unauthenticated users on /setup/* routes', async () => {
		setPath('/setup/abc123token');
		render(Layout, { children: noopSnippet });
		await new Promise(r => setTimeout(r, 50));
		expect(goto).not.toHaveBeenCalledWith('/login', { replaceState: true });
	});

	it('redirects authenticated users away from /login to home', async () => {
		mockAuth.user = { id: 1, username: 'alice', is_admin: false };
		setPath('/login');
		render(Layout, { children: noopSnippet });
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/', { replaceState: true }));
	});
});
