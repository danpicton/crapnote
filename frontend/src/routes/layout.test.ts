import { render } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Snippet } from 'svelte';
import Layout from './+layout.svelte';
import { writable } from 'svelte/store';

// Svelte 5 Snippet is a branded type — cast a no-op fn for tests that only
// exercise redirect logic and never actually render children.
const noopSnippet = (() => {}) as unknown as Snippet;

const goto = vi.hoisted(() => vi.fn());
const preloadCode = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$app/navigation', () => ({ goto, preloadCode }));

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

const mockAuth = vi.hoisted(() => ({
	user: null as object | null,
	loading: false,
	locked: false,
	unlockLockoutMs: 0,
	init: vi.fn(),
	unlock: vi.fn(),
	logout: vi.fn(),
}));
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
	mockAuth.locked = false;
	mockAuth.loading = false;
	mockAuth.unlockLockoutMs = 0;
	mockAuth.init.mockResolvedValue(undefined);
	mockAuth.unlock.mockResolvedValue(true);
	setPath('/');
});

/** A children snippet that would render a marker if it were ever mounted. */
const markerSnippet = (() => {}) as unknown as Snippet;


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

describe('Route code pre-loading', () => {
	it('pre-imports every route on mount so screens open offline without prior visits', async () => {
		render(Layout, { children: noopSnippet });

		await vi.waitFor(() => expect(preloadCode).toHaveBeenCalled());
		const preloaded = preloadCode.mock.calls.map((c) => c[0]);
		// The critical offline screens must all be in the pre-import set.
		for (const route of ['/', '/notes/*', '/settings', '/archive', '/trash', '/login']) {
			expect(preloaded).toContain(route);
		}
	});
});


/**
 * Local unlock (issue #61). A restored-but-unproven identity must not reach
 * the app: the route below it reads the offline cache on mount, so gating
 * inside that route alone would still let a frame of the previous user's
 * notes paint. The layout withholds `children` entirely until the password
 * has been verified.
 */
describe('Layout offline unlock gate', () => {
	it('shows the unlock screen instead of the app when the session is locked', async () => {
		mockAuth.user = { id: 1, username: 'alice', is_admin: false };
		mockAuth.locked = true;
		setPath('/');

		const { getByLabelText, queryByTestId } = render(Layout, { children: markerSnippet });

		await vi.waitFor(() => expect(getByLabelText(/^password for/i)).toBeInTheDocument());
		expect(queryByTestId('layout-children')).not.toBeInTheDocument();
		expect(goto).not.toHaveBeenCalledWith('/login', { replaceState: true });
	});

	it('renders the app once the password unlocks it', async () => {
		mockAuth.user = { id: 1, username: 'alice', is_admin: false };
		mockAuth.locked = true;
		setPath('/');

		const { getByLabelText, getByRole } = render(Layout, { children: markerSnippet });
		await vi.waitFor(() => expect(getByLabelText(/^password for/i)).toBeInTheDocument());

		const input = getByLabelText(/^password for/i) as HTMLInputElement;
		input.value = 'pw';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		getByRole('button', { name: /unlock/i }).click();

		await vi.waitFor(() => expect(mockAuth.unlock).toHaveBeenCalledWith('pw'));
	});

	it('does not gate an ordinary online session', async () => {
		mockAuth.user = { id: 1, username: 'alice', is_admin: false };
		mockAuth.locked = false;
		setPath('/');

		const { queryByLabelText } = render(Layout, { children: markerSnippet });
		await new Promise((r) => setTimeout(r, 50));

		expect(queryByLabelText(/^password for/i)).not.toBeInTheDocument();
	});
});


/**
 * MEDIUM 1 from the security re-review: `auth.locked` is false until the
 * session check resolves, so the {:else} branch used to render first and the
 * notes route mounted on a locked cold start — firing /api/notes and
 * /api/tags. Nothing leaked (the route-level check held), but the layout gate
 * has to actually be a gate, or a later change will drop the route check
 * "because the layout handles it".
 */
describe('Layout withholds the app until the session is settled', () => {
	it('renders no children while the session check is still in flight', async () => {
		mockAuth.loading = true;
		mockAuth.user = null;
		setPath('/');
		mockAuth.init.mockReturnValue(new Promise<void>(() => {}));

		const { container, queryByLabelText } = render(Layout, { children: markerSnippet });
		await new Promise((r) => setTimeout(r, 30));

		// Neither the app nor the unlock screen: which of the two it will be
		// is not known until the session check resolves.
		expect(container.querySelector('[data-testid="app-loading"]')).not.toBeNull();
		expect(queryByLabelText(/^password for/i)).not.toBeInTheDocument();
	});

	it('renders the app once the session has settled', async () => {
		mockAuth.loading = false;
		mockAuth.user = { id: 1, username: 'alice', is_admin: false };
		setPath('/');

		const { container } = render(Layout, { children: markerSnippet });
		await new Promise((r) => setTimeout(r, 30));

		expect(container.querySelector('[data-testid="app-loading"]')).toBeNull();
	});

	it('does not withhold the login screen while auth settles', async () => {
		// Public routes render nothing cached, and blocking them would put a
		// spinner in front of the only way back in.
		mockAuth.loading = true;
		mockAuth.user = null;
		setPath('/login');

		const { container } = render(Layout, { children: markerSnippet });
		await new Promise((r) => setTimeout(r, 30));

		expect(container.querySelector('[data-testid="app-loading"]')).toBeNull();
	});
});
