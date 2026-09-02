import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotePage from './+page.svelte';

vi.mock('@milkdown/kit/preset/commonmark', () => ({
	toggleStrongCommand: { key: 'ToggleStrong' },
	toggleEmphasisCommand: { key: 'ToggleEmphasis' },
	toggleInlineCodeCommand: { key: 'ToggleInlineCode' },
	wrapInBlockquoteCommand: { key: 'WrapInBlockquote' },
	wrapInBulletListCommand: { key: 'WrapInBulletList' },
	wrapInOrderedListCommand: { key: 'WrapInOrderedList' },
	insertHrCommand: { key: 'InsertHr' },
	createCodeBlockCommand: { key: 'CreateCodeBlock' },
	toggleLinkCommand: { key: 'ToggleLink' },
}));

vi.mock('$lib/milkdown/link', () => ({ linkPlugin: [] }));
vi.mock('@milkdown/kit/plugin/history', () => ({
	undoCommand: { key: 'Undo' },
	redoCommand: { key: 'Redo' },
}));
vi.mock('$lib/milkdown/underline', () => ({
	underlinePlugin: [],
	toggleUnderlineCommand: { key: 'ToggleUnderline' },
}));
// Capture the props the page passes to the (mocked) Editor so tests can
// drive its callbacks, e.g. onformatchange.
const editorProps: { current: Record<string, unknown> | null } = { current: null };
vi.mock('$lib/components/Editor.svelte', async () => ({
	default: (anchor: unknown, props: Record<string, unknown>) => {
		void anchor;
		editorProps.current = props;
	},
}));

// Override the page store to supply a real note id in params. `routeState`
// is mutated in place (never reassigned) so a test can pick a different note
// id before render while the store keeps handing out the same object.
const routeState = vi.hoisted(() => ({ params: { id: '42' } }));

vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({
			params: routeState.params,
			url: new URL('http://localhost/notes/42'),
			route: { id: '/notes/[id]' },
			status: 200,
			error: null,
			data: {},
			form: undefined,
			state: {},
		}),
		navigating: readable(null),
		updated: readable(false),
	};
});

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/api', () => {
	class ApiError extends Error {
		constructor(public readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
	}
	class OfflineError extends ApiError {
		constructor(message = 'offline') { super(503, message); this.name = 'OfflineError'; }
	}
	return {
	ApiError,
	OfflineError,
	api: {
		notes: { get: vi.fn(), update: vi.fn(), toggleLock: vi.fn() },
		tags: {
			list: vi.fn(),
			listForNote: vi.fn(),
			addToNote: vi.fn(),
			removeFromNote: vi.fn(),
			create: vi.fn(),
		},
	},
};
});

// Stub the IndexedDB entry points only; pure helpers stay real.
vi.mock('$lib/offlineDB', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/offlineDB')>()),
	openOfflineDB: vi.fn().mockResolvedValue({ close: vi.fn() }),
	getNote: vi.fn().mockResolvedValue(null),
	upsertNote: vi.fn().mockResolvedValue(undefined),
	getAllNotes: vi.fn().mockResolvedValue([]),
	getDirtyNotes: vi.fn().mockResolvedValue([]),
	deleteNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	auth: {
		user: { id: 1, username: 'alice', is_admin: false, created_at: '' },
		loading: false,
		ready: vi.fn().mockResolvedValue(undefined),
		locked: false,
		canReadCache: true,
	},
}));

// The offline-store ownership gate. A handle means "this browser's cache
// belongs to the signed-in user", which is what every other test assumes.
vi.mock('$lib/localData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/localData')>()),
	openOwnedOfflineDB: vi.fn().mockResolvedValue({ close: vi.fn() }),
	// The write-path gate used by $lib/offlineActions; a handle means the
	// store belongs to the signed-in user.
	requireOwnedOfflineDB: vi.fn().mockResolvedValue({ close: vi.fn() }),
}));

import { api } from '$lib/api';
import * as offlineDB from '$lib/offlineDB';
import { openOwnedOfflineDB, requireOwnedOfflineDB, OfflineOwnershipError } from '$lib/localData';
import { auth } from '$lib/stores/auth.svelte';
import { goto } from '$app/navigation';

const mockNote = (overrides = {}) => ({
	id: 42, title: 'My Note', body: '# Hello',
	starred: false, pinned: false, archived: false, locked: false,
	created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
	...overrides,
});

/** Fixed instant the fake clock starts from, so `local_updated_at` can be pinned. */
const FAKE_NOW = '2024-06-01T12:00:00.000Z';
/** Auto-save debounce in the page under test. */
const DEBOUNCE_MS = 800;
/**
 * The instant a debounced save actually runs: the fake clock is advanced by
 * the debounce to trigger it, and vi.setSystemTime-based fake timers move
 * Date along with the timers. Anything written with `new Date()` inside the
 * save must carry exactly this value — a frozen or stale timestamp will not.
 */
const SAVED_AT = new Date(Date.parse(FAKE_NOW) + DEBOUNCE_MS).toISOString();

beforeEach(() => {
	routeState.params.id = '42';
	vi.clearAllMocks();
	// clearAllMocks() clears calls but KEEPS implementations, and the Vitest
	// config sets no mockReset. Without this an api.notes.update rejection
	// configured by one test leaks into every later test in the file.
	vi.mocked(api.notes.update).mockReset();
	vi.mocked(api.notes.get).mockResolvedValue(mockNote());
	vi.mocked(api.tags.listForNote).mockResolvedValue([]);
	vi.mocked(api.tags.list).mockResolvedValue([]);
	vi.mocked(requireOwnedOfflineDB).mockResolvedValue({ close: vi.fn() } as unknown as IDBDatabase);
});

describe('/notes/[id] page', () => {
	it('shows the note title after loading', async () => {
		render(NotePage);
		await waitFor(() => expect(screen.getByDisplayValue('My Note')).toBeInTheDocument());
	});

	it('loads note with the id from the route params', async () => {
		render(NotePage);
		await waitFor(() => expect(api.notes.get).toHaveBeenCalledWith(42));
	});

	it('loads note tags on mount', async () => {
		render(NotePage);
		await waitFor(() => expect(api.tags.listForNote).toHaveBeenCalledWith(42));
	});

	it('back button navigates to /', async () => {
		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.click(screen.getByRole('button', { name: /back to notes/i }));
		expect(goto).toHaveBeenCalledWith('/');
	});

	it('title input change schedules auto-save', async () => {
		vi.useFakeTimers();
		vi.mocked(api.notes.update).mockResolvedValue(mockNote({ title: 'New Title' }));

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.input(screen.getByDisplayValue('My Note'), {
			target: { value: 'New Title' },
		});

		// Auto-save fires after 800 ms debounce. waitFor is inert under fake
		// timers (@testing-library/dom only takes its fake-timer path when a
		// global `jest` exists), so drive the clock and assert directly.
		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(api.notes.update).toHaveBeenCalledWith(42, { title: 'New Title' });
		vi.useRealTimers();
	});

	it('renders the formatting toolbar', async () => {
		render(NotePage);
		await waitFor(() =>
			expect(screen.getAllByRole('toolbar', { name: /formatting/i }).length).toBeGreaterThan(0)
		);
	});

	it('shows existing tags as checkboxes in the popover when opened', async () => {
		vi.mocked(api.tags.list).mockResolvedValue([
			{ id: 1, name: 'Work', note_count: 2 },
		]);
		vi.mocked(api.tags.listForNote).mockResolvedValue([
			{ id: 1, name: 'Work', note_count: 2 },
		]);

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		// Open tag popover — popover shows one checkbox per tag
		await fireEvent.click(screen.getByTitle('Tags'));
		await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument());
	});

	it('removes a tag when its checkbox is unchecked', async () => {
		vi.mocked(api.tags.list).mockResolvedValue([
			{ id: 1, name: 'Work', note_count: 2 },
		]);
		vi.mocked(api.tags.listForNote).mockResolvedValue([
			{ id: 1, name: 'Work', note_count: 2 },
		]);
		vi.mocked(api.tags.removeFromNote).mockResolvedValue(undefined);
		vi.mocked(api.tags.list)
			.mockResolvedValueOnce([{ id: 1, name: 'Work', note_count: 2 }]) // initial load
			.mockResolvedValue([{ id: 1, name: 'Work', note_count: 1 }]);   // after remove

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.click(screen.getByTitle('Tags'));
		const checkbox = await waitFor(() => screen.getByRole('checkbox'));
		await fireEvent.change(checkbox);
		await waitFor(() =>
			expect(api.tags.removeFromNote).toHaveBeenCalledWith(42, 1)
		);
	});
});

describe('/notes/[id] offline mode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(api.tags.listForNote).mockResolvedValue([]);
		vi.mocked(api.tags.list).mockResolvedValue([]);
	});

	it('falls back to IndexedDB when the API call throws while offline', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(api.notes.get).mockRejectedValue(new Error('offline'));
		vi.mocked(offlineDB.getNote).mockResolvedValue({
			id: 42, title: 'Cached Title', body: 'Cached body',
			starred: false, pinned: false, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z',
			local_updated_at: '2024-01-01T00:00:00Z',
			is_dirty: false, is_new: false,
		});

		render(NotePage);
		await waitFor(() => expect(screen.getByDisplayValue('Cached Title')).toBeInTheDocument());
	});

	it('prefers dirty IDB content over server response when online (regression)', async () => {
		// User edited this note offline; now online but sync hasn't succeeded yet.
		// Loading the note page must NOT overwrite their unsynced edit with the stale server copy.
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.get).mockResolvedValue({
			id: 42, title: 'Stale Server', body: 'Stale body',
			starred: false, pinned: false, archived: false, locked: false,
			created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
		});
		vi.mocked(offlineDB.getNote).mockResolvedValue({
			id: 42, title: 'Unsynced Edit', body: 'Unsynced body',
			starred: false, pinned: false, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z',
			local_updated_at: '2024-01-02T00:00:00Z',
			is_dirty: true, is_new: false,
		});

		render(NotePage);

		// The user's unsynced edit should win over the stale server copy.
		await waitFor(() => expect(screen.getByDisplayValue('Unsynced Edit')).toBeInTheDocument());
		expect(screen.queryByDisplayValue('Stale Server')).not.toBeInTheDocument();
	});

	it('saves to IndexedDB when offline and auto-save fires', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.useFakeTimers();
		vi.mocked(api.notes.get).mockRejectedValue(new Error('offline'));
		vi.mocked(offlineDB.getNote).mockResolvedValue({
			id: 42, title: 'My Note', body: 'Hello',
			starred: false, pinned: false, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z',
			local_updated_at: '2024-01-01T00:00:00Z',
			is_dirty: false, is_new: false,
		});

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.input(screen.getByDisplayValue('My Note'), {
			target: { value: 'Edited Offline' },
		});

		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ title: 'Edited Offline', is_dirty: true })
		);
		expect(api.notes.update).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('builds a fresh dirty CachedNote when IndexedDB has no entry for the note', async () => {
		// The note loaded from the server but was never cached in IndexedDB;
		// the connection then drops before the user edits. saveOfflineEdit has
		// to construct a CachedNote from in-memory state (the `existing ?? {…}`
		// branch) — the old code silently dropped the edit here.
		//
		// The in-memory state is deliberately NON-default (starred, pinned, a
		// tag, a distinct updated_at) so these assertions distinguish real
		// state from the `?? false` / `[]` fallbacks in the code under test.
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.useFakeTimers();
		vi.setSystemTime(new Date(FAKE_NOW));
		vi.mocked(api.notes.get).mockResolvedValue(
			mockNote({ starred: true, pinned: true, updated_at: '2024-05-01T00:00:00Z' })
		);
		vi.mocked(api.tags.listForNote).mockResolvedValue([{ id: 7, name: 'Work', note_count: 3 }]);
		vi.mocked(offlineDB.getNote).mockResolvedValue(null);

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		// Connection drops after the note is on screen.
		vi.stubGlobal('navigator', { ...navigator, onLine: false });

		await fireEvent.input(screen.getByDisplayValue('My Note'), {
			target: { value: 'Edited Offline' },
		});

		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(offlineDB.upsertNote).toHaveBeenCalled();

		const written = vi.mocked(offlineDB.upsertNote).mock.calls[0][1];
		expect(written).toMatchObject({
			id: 42,
			title: 'Edited Offline',
			body: '# Hello',            // untouched field taken from in-memory state
			starred: true,              // carried from the note, not the `?? false` fallback
			pinned: true,
			server_updated_at: '2024-05-01T00:00:00Z',
			is_dirty: true,
			is_new: false,              // id 42 is a real server note, not offline-created
		});
		// toMatchObject matches array members partially, so pin the tags exactly.
		expect(written.tags).toEqual([{ id: 7, name: 'Work' }]);
		// local_updated_at must be NOW, not merely a well-formed ISO string: a
		// frozen or stale value makes the `localWins` comparison in
		// offlineSync.ts fail, silently discarding the offline edit.
		expect(written.local_updated_at).toBe(SAVED_AT);
		expect(new Date(written.local_updated_at).getTime()).toBeGreaterThan(
			new Date(written.server_updated_at).getTime()
		);
		expect(api.notes.update).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('marks the cached record is_new for an offline-created (negative id) note', async () => {
		// Notes created offline carry a negative temp id. saveOfflineEdit must
		// flag them is_new so sync POSTs them instead of PATCHing a server id
		// that does not exist. With the usual id 42 that assertion is vacuous.
		routeState.params.id = '-1';
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.useFakeTimers();
		vi.setSystemTime(new Date(FAKE_NOW));
		vi.mocked(api.notes.get).mockResolvedValue(mockNote({ id: -1 }));
		vi.mocked(offlineDB.getNote).mockResolvedValue(null);

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.input(screen.getByDisplayValue('My Note'), {
			target: { value: 'Edited Offline' },
		});

		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(offlineDB.upsertNote).toHaveBeenCalled();

		const written = vi.mocked(offlineDB.upsertNote).mock.calls[0][1];
		expect(written).toMatchObject({
			id: -1,
			title: 'Edited Offline',
			is_new: true,
			is_dirty: true,
		});
		// A negative id never goes to the server, even while navigator is online.
		expect(api.notes.update).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('preserves every untouched field of an already-cached note', async () => {
		// The COMMON path: the note is already in IndexedDB, so saveOfflineEdit
		// takes the `{ ...existing }` branch. Editing the title must change the
		// title, the timestamp and the dirty flag — and nothing else. Wiping
		// body/starred/tags/server_updated_at here is the worst data-loss case
		// in the function, and no test caught it before this one.
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.useFakeTimers();
		vi.setSystemTime(new Date(FAKE_NOW));
		vi.mocked(api.notes.get).mockRejectedValue(new Error('offline'));
		const cached = {
			id: 42,
			title: 'My Note',
			body: 'Cached body worth keeping',
			starred: true,
			pinned: true,
			locked: false,
			pin_order: 3,
			tags: [{ id: 7, name: 'Work' }],
			server_updated_at: '2024-05-01T00:00:00Z',
			local_updated_at: '2024-05-02T00:00:00Z',
			is_dirty: false,
			is_new: false,
		};
		vi.mocked(offlineDB.getNote).mockResolvedValue({ ...cached });

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.input(screen.getByDisplayValue('My Note'), {
			target: { value: 'Edited Offline' },
		});

		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(offlineDB.upsertNote).toHaveBeenCalled();

		// toEqual, not toMatchObject: a dropped or clobbered field must fail.
		const written = vi.mocked(offlineDB.upsertNote).mock.calls[0][1];
		expect(written).toEqual({
			...cached,
			title: 'Edited Offline',
			local_updated_at: SAVED_AT,
			is_dirty: true,
		});
		expect(api.notes.update).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('saves to IndexedDB when the server is unreachable mid-online-edit', async () => {
		// navigator says we are online, but the request fails (network error or
		// a 503 from the service worker). The edit must land in IndexedDB
		// rather than being lost.
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.useFakeTimers();
		vi.setSystemTime(new Date(FAKE_NOW));
		vi.mocked(api.notes.get).mockResolvedValue(mockNote({ updated_at: '2024-05-01T00:00:00Z' }));
		vi.mocked(offlineDB.getNote).mockResolvedValue(null);
		// The top-level beforeEach mockReset()s this again, so the rejection
		// cannot leak into later tests.
		vi.mocked(api.notes.update).mockRejectedValue(new Error('network error'));

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.input(screen.getByDisplayValue('My Note'), {
			target: { value: 'Edited While Unreachable' },
		});

		await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		expect(api.notes.update).toHaveBeenCalledWith(42, { title: 'Edited While Unreachable' });
		expect(offlineDB.upsertNote).toHaveBeenCalled();

		const written = vi.mocked(offlineDB.upsertNote).mock.calls[0][1];
		expect(written).toMatchObject({
			id: 42,
			title: 'Edited While Unreachable',
			body: '# Hello',
			server_updated_at: '2024-05-01T00:00:00Z',
			is_dirty: true,
			is_new: false,
		});
		// Freshness, not just ISO formatting: sync compares this against the
		// server's edit time to decide whether the local edit wins.
		expect(written.local_updated_at).toBe(SAVED_AT);
		expect(new Date(written.local_updated_at).getTime()).toBeGreaterThan(
			new Date(written.server_updated_at).getTime()
		);
		vi.useRealTimers();
	});
});

describe('Mobile format bar active state', () => {
	it('highlights the Bold button when the editor reports strong active', async () => {
		const { EMPTY_FORMATS } = await import('$lib/milkdown/formatState');

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		const onformatchange = editorProps.current?.onformatchange as
			| ((f: typeof EMPTY_FORMATS) => void)
			| undefined;
		expect(onformatchange).toBeTypeOf('function');

		onformatchange!({ ...EMPTY_FORMATS, strong: true });

		const boldBtn = () =>
			document.querySelector('.mob-format-bar [aria-label="Bold"]')!;
		await waitFor(() => expect(boldBtn()).toHaveClass('mob-tb-btn-active'));

		// And it clears again when the cursor moves out of bold text
		onformatchange!({ ...EMPTY_FORMATS });
		await waitFor(() => expect(boldBtn()).not.toHaveClass('mob-tb-btn-active'));
	});
});

describe('Link toolbar', () => {
	it('shows the Insert link button', async () => {
		render(NotePage);
		await waitFor(() =>
			expect(screen.getByTitle('Insert link (Ctrl+K)')).toBeInTheDocument()
		);
	});

	it('clicking the link button shows the URL input dialog', async () => {
		render(NotePage);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));

		expect(screen.getAllByPlaceholderText(/https/i).length).toBeGreaterThan(0);
		expect(screen.getAllByRole('button', { name: /apply/i }).length).toBeGreaterThan(0);
	});

	it('pressing Escape closes the dialog', async () => {
		render(NotePage);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		const input = screen.getAllByPlaceholderText(/https/i)[0];

		await fireEvent.keyDown(input, { key: 'Escape' });

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('clicking the backdrop closes the dialog', async () => {
		render(NotePage);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		expect(screen.getAllByPlaceholderText(/https/i).length).toBeGreaterThan(0);

		await fireEvent.click(document.querySelector('.link-dialog-backdrop')!);

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('pressing Enter in the URL input closes the dialog', async () => {
		render(NotePage);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		const input = screen.getAllByPlaceholderText(/https/i)[0];
		await fireEvent.input(input, { target: { value: 'https://example.com' } });

		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('clicking Apply closes the dialog', async () => {
		render(NotePage);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		await fireEvent.click(screen.getAllByRole('button', { name: /apply/i })[0]);

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});
});

describe('Note locking', () => {
	// An earlier test stubs navigator offline and never restores it; these
	// tests exercise the online load path.
	beforeEach(() => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
	});

	it('makes the title read-only while the note is locked', async () => {
		vi.mocked(api.notes.get).mockResolvedValue(mockNote({ locked: true }));

		render(NotePage);
		const title = await waitFor(() => screen.getByDisplayValue('My Note'));

		expect((title as HTMLInputElement).readOnly).toBe(true);
	});

	it('leaves the title editable when the note is unlocked', async () => {
		render(NotePage);
		const title = await waitFor(() => screen.getByDisplayValue('My Note'));

		expect((title as HTMLInputElement).readOnly).toBe(false);
	});

	it('does not save edits made to a locked note', async () => {
		vi.useFakeTimers();
		vi.mocked(api.notes.get).mockResolvedValue(mockNote({ locked: true }));

		render(NotePage);
		const title = await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.input(title, { target: { value: 'changed' } });
		await vi.advanceTimersByTimeAsync(1000); // well past the 800ms debounce

		expect(api.notes.update).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('offers a lock toggle that calls the API', async () => {
		vi.mocked(api.notes.toggleLock).mockResolvedValue(mockNote({ locked: true }));

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.click(screen.getByTitle('Lock note'));

		await waitFor(() => expect(api.notes.toggleLock).toHaveBeenCalledWith(42));
		await waitFor(() => expect(screen.getByTitle('Unlock note')).toBeTruthy());
	});
});

describe('Mobile lock control', () => {
	beforeEach(() => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
	});

	it('puts a lock toggle in the mobile top bar, not just the action sheet', async () => {
		vi.mocked(api.notes.toggleLock).mockResolvedValue(mockNote({ locked: true }));

		const { container } = render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		const btn = container.querySelector(
			'.mob-topbar button[aria-label="Lock note"]'
		) as HTMLElement;
		expect(btn).toBeTruthy();

		await fireEvent.click(btn);
		await waitFor(() => expect(api.notes.toggleLock).toHaveBeenCalledWith(42));
	});

	it('reflects the locked state in the mobile top bar', async () => {
		vi.mocked(api.notes.get).mockResolvedValue(mockNote({ locked: true }));

		const { container } = render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		expect(container.querySelector('.mob-topbar button[aria-label="Unlock note"]')).toBeTruthy();
	});
});

describe('Offline lock toggle', () => {
	it('unlocking offline applies optimistically and queues the desired state for sync', async () => {
		const { OfflineError } = await import('$lib/api');
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.get).mockResolvedValue(mockNote({ locked: true }));
		vi.mocked(api.notes.toggleLock).mockRejectedValue(new OfflineError());

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.click(screen.getByTitle('Unlock note'));

		// UI reflects the unlock immediately…
		await waitFor(() => expect(screen.getByTitle('Lock note')).toBeTruthy());
		// …and the desired state is recorded for the sync reconcile.
		await waitFor(() =>
			expect(offlineDB.upsertNote).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ id: 42, locked: false, flags_dirty: true })
			)
		);
	});
});


/**
 * Read-path ownership gate (issue #61). A guarded notes list is worthless if
 * the note ids — small consecutive integers — can be typed into the URL bar
 * to read the same cached bodies one at a time.
 */
describe('/notes/[id] offline cache ownership guard', () => {
	const foreign = {
		id: 42, title: "Previous user's title", body: "Previous user's body",
		starred: false, pinned: false, tags: [{ id: 3, name: 'private-tag' }],
		server_updated_at: '2024-01-01T00:00:00Z',
		local_updated_at: '2024-01-01T00:00:00Z',
		is_dirty: false, is_new: false,
	};

	beforeEach(() => {
		vi.mocked(api.tags.listForNote).mockResolvedValue([]);
		vi.mocked(api.tags.list).mockResolvedValue([]);
		vi.mocked(openOwnedOfflineDB).mockResolvedValue(null);
		vi.mocked(offlineDB.getNote).mockResolvedValue(foreign);
		(auth as { canReadCache: boolean }).canReadCache = true;
	});

	it('reads nothing while the restored session is still locked', async () => {
		// The list route is gated by the layout; this route must refuse on its
		// own too, since note ids are guessable and go straight to the store.
		(auth as { canReadCache: boolean }).canReadCache = false;
		vi.mocked(openOwnedOfflineDB).mockResolvedValue({ close: vi.fn() } as unknown as IDBDatabase);
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(api.notes.get).mockRejectedValue(new Error('offline'));

		render(NotePage);
		await new Promise((r) => setTimeout(r, 20));

		expect(screen.queryByDisplayValue("Previous user's title")).not.toBeInTheDocument();
		expect(offlineDB.getNote).not.toHaveBeenCalled();
		expect(openOwnedOfflineDB).not.toHaveBeenCalled();
	});

	it('renders nothing cached when offline and the store belongs to someone else', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(api.notes.get).mockRejectedValue(new Error('offline'));

		render(NotePage);
		await waitFor(() => expect(api.notes.get).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 20));

		expect(screen.queryByDisplayValue("Previous user's title")).not.toBeInTheDocument();
		expect(offlineDB.getNote).not.toHaveBeenCalled();
	});

	it('does not overlay a foreign cached edit onto the server copy', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.get).mockResolvedValue(mockNote({ title: 'Server Title' }));
		vi.mocked(offlineDB.getNote).mockResolvedValue({ ...foreign, is_dirty: true });

		render(NotePage);
		await waitFor(() => expect(screen.getByDisplayValue('Server Title')).toBeInTheDocument());

		expect(screen.queryByDisplayValue("Previous user's title")).not.toBeInTheDocument();
		expect(offlineDB.getNote).not.toHaveBeenCalled();
	});

	it('does not open an offline-created note out of a foreign store', async () => {
		// Negative ids never reach the server, so the cache read is the only
		// thing standing between the URL and the previous user's note.
		routeState.params.id = '-7';
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(api.notes.get).mockRejectedValue(new Error('offline'));
		vi.mocked(offlineDB.getNote).mockResolvedValue({ ...foreign, id: -7, is_new: true });

		render(NotePage);
		await new Promise((r) => setTimeout(r, 20));

		expect(screen.queryByDisplayValue("Previous user's title")).not.toBeInTheDocument();
		expect(offlineDB.getNote).not.toHaveBeenCalled();
	});
});


/**
 * Write-path ownership gate (issue #107). `ensureOfflineOwner` swallows its
 * own failures, so an offline edit can arrive at a store still stamped with
 * another account. It must be refused — visibly, since a dropped save looks
 * identical to a successful one in the editor.
 */
describe('/notes/[id] offline write ownership guard', () => {
	const cached = {
		id: 42, title: 'My Note', body: 'Hello',
		starred: false, pinned: false, tags: [],
		server_updated_at: '2024-01-01T00:00:00Z',
		local_updated_at: '2024-01-01T00:00:00Z',
		is_dirty: false, is_new: false,
	};

	beforeEach(() => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		(auth as { canReadCache: boolean }).canReadCache = true;
		vi.mocked(api.notes.get).mockRejectedValue(new Error('offline'));
		vi.mocked(offlineDB.getNote).mockResolvedValue(cached);
		vi.mocked(openOwnedOfflineDB).mockResolvedValue({ close: vi.fn() } as unknown as IDBDatabase);
		vi.mocked(requireOwnedOfflineDB).mockResolvedValue({ close: vi.fn() } as unknown as IDBDatabase);
	});

	it('refuses an offline edit into a store owned by someone else', async () => {
		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		// The store turns out to belong to another account by save time.
		vi.mocked(openOwnedOfflineDB).mockResolvedValue(null);
		vi.useFakeTimers();
		await fireEvent.input(screen.getByDisplayValue('My Note'), {
			target: { value: 'Edited Offline' },
		});
		await vi.advanceTimersByTimeAsync(1000);
		vi.useRealTimers();

		expect(offlineDB.upsertNote).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be saved/i));
	});

	it('still saves an offline edit into the signed-in user\'s own store', async () => {
		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		vi.useFakeTimers();
		await fireEvent.input(screen.getByDisplayValue('My Note'), {
			target: { value: 'Edited Offline' },
		});
		await vi.advanceTimersByTimeAsync(1000);
		vi.useRealTimers();

		expect(offlineDB.upsertNote).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id: 42, title: 'Edited Offline', is_dirty: true })
		);
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('surfaces a refused offline flag toggle instead of pretending it stuck', async () => {
		const { OfflineError } = await import('$lib/api');
		// Online enough to load the note; only the toggle hits the network.
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.get).mockResolvedValue(mockNote({ locked: true }));
		vi.mocked(api.notes.toggleLock).mockRejectedValue(new OfflineError());
		vi.mocked(requireOwnedOfflineDB).mockRejectedValue(new OfflineOwnershipError());

		render(NotePage);
		await waitFor(() => screen.getByDisplayValue('My Note'));

		await fireEvent.click(screen.getByTitle('Unlock note'));

		await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be saved/i));
		// The unlock must not look applied when it was never recorded.
		expect(screen.getByTitle('Unlock note')).toBeTruthy();
	});
});
