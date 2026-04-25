import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from './+page.svelte';

// Stub all heavy Milkdown imports — they use browser APIs that hang in jsdom
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

vi.mock('$lib/api', () => ({
	api: {
		notes: {
			list: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			toggleStar: vi.fn(),
			togglePin: vi.fn(),
			archive: vi.fn(),
			listArchived: vi.fn(),
		},
		tags: { list: vi.fn(), listForNote: vi.fn().mockResolvedValue([]) },
		auth: { logout: vi.fn() },
	},
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	auth: { user: { id: 1, username: 'alice', is_admin: false, created_at: '' }, loading: false, logout: vi.fn() },
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/components/Editor.svelte', async () => ({
	default: (anchor: unknown, props: unknown) => { void anchor; void props; },
}));

vi.mock('$lib/milkdown/underline', () => ({
	underlinePlugin: [],
	toggleUnderlineCommand: { key: 'ToggleUnderline' },
}));

vi.mock('$lib/offlineDB', () => ({
	openOfflineDB: vi.fn().mockResolvedValue({ close: vi.fn() }),
	getAllNotes: vi.fn().mockResolvedValue([]),
	getDirtyNotes: vi.fn().mockResolvedValue([]),
	getNote: vi.fn().mockResolvedValue(null),
	upsertNote: vi.fn().mockResolvedValue(undefined),
	deleteNote: vi.fn().mockResolvedValue(undefined),
}));

const emptySyncResult = {
	trigger: 'heartbeat' as const,
	startedAt: '',
	durationMs: 0,
	mappings: [] as Array<{ tempId: number; serverId: number }>,
	pushed: { created: 0, updated: 0 },
	conflicts: 0,
	errors: 0,
	skipped: false,
};

vi.mock('$lib/offlineSync', () => ({
	syncOfflineChanges: vi.fn().mockResolvedValue({
		trigger: 'heartbeat',
		startedAt: '',
		durationMs: 0,
		mappings: [],
		pushed: { created: 0, updated: 0 },
		conflicts: 0,
		errors: 0,
		skipped: false,
	}),
}));


import { api } from '$lib/api';
import * as offlineDB from '$lib/offlineDB';
import { syncOfflineChanges } from '$lib/offlineSync';

// Helper: override matchMedia to simulate a mobile or desktop viewport for one test.
function mockViewport(mobile: boolean) {
	vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
		matches: mobile && query === '(max-width: 767px)',
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})));
}

const mockNote = (overrides = {}) => ({
	id: 1, title: 'Test Note', body: '# Hello',
	starred: false, pinned: false, archived: false,
	created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.notes.list).mockResolvedValue([mockNote()]);
	vi.mocked(api.tags.list).mockResolvedValue([]);
});

describe('Notes page', () => {
	it('renders the app title', async () => {
		render(Page);
		await waitFor(() => expect(screen.getByText('Crapnote')).toBeInTheDocument());
	});

	it('shows the note list after load', async () => {
		render(Page);
		await waitFor(() => expect(screen.getByText('Test Note')).toBeInTheDocument());
	});

	it('shows new note button', async () => {
		render(Page);
		await waitFor(() => expect(screen.getByRole('button', { name: /new note/i })).toBeInTheDocument());
	});

	it('new note is inserted after pinned notes', async () => {
		const pinned = mockNote({ id: 1, title: 'Pinned', pinned: true });
		const regular = mockNote({ id: 2, title: 'Regular' });
		vi.mocked(api.notes.list).mockResolvedValue([pinned, regular]);
		vi.mocked(api.notes.create).mockResolvedValueOnce(mockNote({ id: 3, title: 'New Note' }));

		render(Page);
		await waitFor(() => screen.getByText('Pinned'));
		// Use title to target the sidebar header button specifically
		await fireEvent.click(screen.getByTitle('New note'));
		await waitFor(() => expect(api.notes.create).toHaveBeenCalled());
	});

	it('shows logout button', async () => {
		render(Page);
		await waitFor(() => expect(screen.getByTitle(/log out/i)).toBeInTheDocument());
	});

	it('shows settings button', async () => {
		render(Page);
		await waitFor(() => expect(screen.getByTitle(/settings/i)).toBeInTheDocument());
	});

	it('shows archive nav button in sidebar bottom', async () => {
		render(Page);
		await waitFor(() => {
			// The archive link in the bottom bar has title="Archive"
			const archiveLinks = screen.getAllByTitle(/archive/i);
			expect(archiveLinks.length).toBeGreaterThan(0);
		});
	});

	it('calls archive when archive button clicked on note', async () => {
		vi.mocked(api.notes.archive).mockResolvedValueOnce(undefined);
		render(Page);
		await waitFor(() => screen.getByText('Test Note'));
		const archiveBtn = screen.getByRole('button', { name: /move to archive/i });
		await fireEvent.click(archiveBtn);
		await waitFor(() => expect(api.notes.archive).toHaveBeenCalledWith(1));
	});

	it('renders formatting toolbar', async () => {
		render(Page);
		await waitFor(() => expect(screen.getByRole('toolbar', { name: /formatting/i })).toBeInTheDocument());
	});
});

describe('Mobile navigation', () => {
	beforeEach(() => {
		mockViewport(true); // mobile for every test in this block
	});

	it('clicking a note navigates to /notes/[id] on mobile', async () => {
		const { goto } = await import('$app/navigation');
		render(Page);
		await waitFor(() => screen.getByText('Test Note'));

		// Click the note button
		const noteBtn = screen.getAllByRole('button').find(
			(b) => b.classList.contains('note-btn')
		);
		await fireEvent.click(noteBtn!);

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/notes/1'));
	});

	it('new note navigates to /notes/[id] on mobile', async () => {
		const { goto } = await import('$app/navigation');
		vi.mocked(api.notes.create).mockResolvedValueOnce(
			{ id: 99, title: '', body: '', starred: false, pinned: false, archived: false,
			  created_at: '', updated_at: '' }
		);

		render(Page);
		await waitFor(() => screen.getByText('Test Note'));

		// Grab the sidebar header button specifically (title attr distinguishes it from
		// the empty-state button which is CSS-hidden on mobile but still in the DOM)
		const newBtn = screen.getByTitle('New note');
		await fireEvent.click(newBtn);

		// The `?new=1` flag tells the single-note page to focus + select the
		// title input so the user can immediately overwrite the default title.
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/notes/99?new=1'));
	});

	it('clicking a note on desktop does NOT navigate — shows editor in-pane', async () => {
		mockViewport(false); // override to desktop
		const { goto } = await import('$app/navigation');
		vi.mocked(api.tags.listForNote).mockResolvedValue([]);

		render(Page);
		await waitFor(() => screen.getByText('Test Note'));

		const noteBtn = screen.getAllByRole('button').find(
			(b) => b.classList.contains('note-btn')
		);
		await fireEvent.click(noteBtn!);

		// No navigation on desktop
		expect(goto).not.toHaveBeenCalledWith(expect.stringMatching(/\/notes\//));
	});
});

describe('Link toolbar', () => {
	it('shows the Insert link button in the toolbar', async () => {
		render(Page);
		await waitFor(() =>
			expect(screen.getByTitle('Insert link (Ctrl+K)')).toBeInTheDocument()
		);
	});

	it('clicking the link button shows the URL input dialog', async () => {
		render(Page);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));

		expect(screen.getByPlaceholderText(/https/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
	});

	it('pressing Escape closes the dialog', async () => {
		render(Page);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		const input = screen.getByPlaceholderText(/https/i);

		await fireEvent.keyDown(input, { key: 'Escape' });

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('clicking the backdrop closes the dialog', async () => {
		render(Page);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		expect(screen.getByPlaceholderText(/https/i)).toBeInTheDocument();

		await fireEvent.click(document.querySelector('.link-dialog-backdrop')!);

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('pressing Enter in the URL input closes the dialog', async () => {
		render(Page);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		const input = screen.getByPlaceholderText(/https/i);
		await fireEvent.input(input, { target: { value: 'https://example.com' } });

		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('clicking Apply closes the dialog', async () => {
		render(Page);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		await fireEvent.click(screen.getByRole('button', { name: /apply/i }));

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});
});

describe('Tag popover', () => {
	const mockTag = (overrides = {}) => ({
		id: 1,
		name: 'work',
		note_count: 2,
		...overrides,
	});

	it('shows tags with note_count > 0 as checkboxes in the popover', async () => {
		vi.mocked(api.tags.list).mockResolvedValue([mockTag({ id: 1, name: 'work', note_count: 2 })]);
		render(Page);

		await waitFor(() => screen.getByTitle('Tags'));
		await fireEvent.click(screen.getByTitle('Tags'));

		await waitFor(() => {
			expect(screen.getByRole('checkbox', { name: /work/i })).toBeInTheDocument();
		});
	});

	it('does not show orphaned tags (note_count 0) in the popover', async () => {
		vi.mocked(api.tags.list).mockResolvedValue([mockTag({ id: 2, name: 'orphaned', note_count: 0 })]);
		render(Page);

		await waitFor(() => screen.getByTitle('Tags'));
		await fireEvent.click(screen.getByTitle('Tags'));

		// Confirm the popover is open (the new-tag input is inside it).
		await waitFor(() => expect(screen.getByPlaceholderText('New tag…')).toBeInTheDocument());

		expect(screen.queryByRole('checkbox', { name: /orphaned/i })).not.toBeInTheDocument();
	});

	it('shows active tag but hides orphaned tag when both exist', async () => {
		vi.mocked(api.tags.list).mockResolvedValue([
			mockTag({ id: 1, name: 'active-tag', note_count: 3 }),
			mockTag({ id: 2, name: 'dead-tag', note_count: 0 }),
		]);
		render(Page);

		await waitFor(() => screen.getByTitle('Tags'));
		await fireEvent.click(screen.getByTitle('Tags'));

		await waitFor(() => {
			expect(screen.getByRole('checkbox', { name: /active-tag/i })).toBeInTheDocument();
		});
		expect(screen.queryByRole('checkbox', { name: /dead-tag/i })).not.toBeInTheDocument();
	});
});

describe('Pane switcher', () => {
	const mockTags = [
		{ id: 1, name: 'Alpha', note_count: 1 },
		{ id: 2, name: 'Beta',  note_count: 1 },
	];

	beforeEach(() => {
		vi.mocked(api.tags.list).mockResolvedValue(mockTags);
	});

	it('shows All, Starred and Tags tabs', async () => {
		render(Page);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: /^all/i })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /^starred/i })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /^tags/i })).toBeInTheDocument();
		});
	});

	it('clicking the Tags tab reveals the tag panel', async () => {
		render(Page);
		await waitFor(() => screen.getByRole('button', { name: /^tags/i }));

		await fireEvent.click(screen.getByRole('button', { name: /^tags/i }));

		await waitFor(() =>
			expect(screen.getByRole('group', { name: /tag filters/i })).toBeInTheDocument()
		);
		expect(screen.getByRole('button', { name: /alpha/i })).toBeInTheDocument();
	});

	it('clicking All tab hides the tag panel', async () => {
		render(Page);
		await waitFor(() => screen.getByRole('button', { name: /^tags/i }));

		await fireEvent.click(screen.getByRole('button', { name: /^tags/i }));
		await waitFor(() => screen.getByRole('group', { name: /tag filters/i }));

		await fireEvent.click(screen.getByRole('button', { name: /^all/i }));

		await waitFor(() =>
			expect(screen.queryByRole('group', { name: /tag filters/i })).not.toBeInTheDocument()
		);
	});
});

describe('Offline mode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(api.notes.list).mockResolvedValue([]);
		vi.mocked(api.tags.list).mockResolvedValue([]);
		vi.mocked(api.tags.listForNote).mockResolvedValue([]);
	});

	it('shows an offline indicator when navigator.onLine is false', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 1, title: 'Cached Note', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: false, is_new: false },
		]);

		render(Page);
		await waitFor(() => expect(screen.getByText(/offline/i)).toBeInTheDocument());
	});

	it('loads notes from IndexedDB when offline', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 1, title: 'Cached Offline Note', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: false, is_new: false },
		]);

		render(Page);
		await waitFor(() => expect(screen.getByText('Cached Offline Note')).toBeInTheDocument());
		expect(api.notes.list).not.toHaveBeenCalled();
	});

	it('caches notes to IndexedDB after a successful online load', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.list).mockResolvedValue([
			{ id: 5, title: 'Online Note', body: '', starred: false, pinned: false,
			  archived: false, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
		]);

		render(Page);
		await waitFor(() => screen.getByText('Online Note'));
		await waitFor(() => expect(offlineDB.upsertNote).toHaveBeenCalled());
	});

	it('falls back to IndexedDB if the API call throws while apparently online', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.list).mockRejectedValue(new Error('Network error'));
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 2, title: 'Fallback Note', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: false, is_new: false },
		]);

		render(Page);
		await waitFor(() => expect(screen.getByText('Fallback Note')).toBeInTheDocument());
	});

	it('runs sync then reloads from server when coming online', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.list).mockResolvedValue([]);
		vi.mocked(syncOfflineChanges).mockResolvedValue(emptySyncResult);
		// heartbeatSync only calls syncOfflineChanges if dirty notes exist
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([
			{ id: 5, title: 'Dirty', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z',
			  is_dirty: true, is_new: false },
		]);

		render(Page);
		window.dispatchEvent(new Event('online'));
		await waitFor(() => expect(syncOfflineChanges).toHaveBeenCalled());
	});

	it('creates a new offline note in IndexedDB when offline', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([]);
		vi.mocked(offlineDB.upsertNote).mockResolvedValue(undefined);

		render(Page);
		await waitFor(() => screen.getByTitle('New note'));
		await fireEvent.click(screen.getByTitle('New note'));

		await waitFor(() => expect(offlineDB.upsertNote).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ is_new: true, is_dirty: true })
		));
		expect(api.notes.create).not.toHaveBeenCalled();
	});

	it('falls back to offline note creation when online but API throws', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.list).mockResolvedValue([]);
		vi.mocked(api.notes.create).mockRejectedValue(new Error('Network error'));

		render(Page);
		await waitFor(() => screen.getByTitle('New note'));
		await fireEvent.click(screen.getByTitle('New note'));

		await waitFor(() => expect(offlineDB.upsertNote).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ is_new: true, is_dirty: true })
		));
	});

	it('keeps dirty note content visible after reconnect when sync failed', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		// Server has the old version
		vi.mocked(api.notes.list).mockResolvedValue([
			{ id: 5, title: 'Server Title', body: 'Server body', starred: false, pinned: false,
			  archived: false, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
		]);
		// Sync returns no mappings (e.g. sync failed silently)
		vi.mocked(syncOfflineChanges).mockResolvedValue(emptySyncResult);
		// After reload, note 5 is still dirty (sync failed)
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([
			{ id: 5, title: 'Local Edit', body: 'Local body', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z',
			  is_dirty: true, is_new: false },
		]);
		// getAllNotes also needed for merge: return dirty note so merge sees it
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 5, title: 'Local Edit', body: 'Local body', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z',
			  is_dirty: true, is_new: false },
		]);

		render(Page);
		window.dispatchEvent(new Event('online'));

		await waitFor(() => expect(screen.getByText('Local Edit')).toBeInTheDocument());
	});

	it('FINAL state after reconnect shows dirty content, not server content (regression)', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		// Server has the OLD version (sync failed so server never got the local edit)
		vi.mocked(api.notes.list).mockResolvedValue([
			{ id: 5, title: 'Server Title', body: 'Server body', starred: false, pinned: false,
			  archived: false, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
		]);
		vi.mocked(syncOfflineChanges).mockResolvedValue(emptySyncResult);
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([
			{ id: 5, title: 'Local Edit', body: 'Local body', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z',
			  is_dirty: true, is_new: false },
		]);
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 5, title: 'Local Edit', body: 'Local body', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z',
			  is_dirty: true, is_new: false },
		]);

		render(Page);
		// Wait for initial load to settle
		await waitFor(() => expect(screen.getByText(/Local Edit|Server Title/)).toBeInTheDocument());

		window.dispatchEvent(new Event('online'));

		// Wait for both heartbeat sync AND loadNotes to fire
		await waitFor(() => expect(syncOfflineChanges).toHaveBeenCalled());
		await waitFor(() => expect(api.notes.list).toHaveBeenCalled());
		// Let every pending promise settle
		await new Promise((r) => setTimeout(r, 50));

		// FINAL state: the user should see their unsynced local edit, NOT the server title
		expect(screen.queryByText('Server Title')).not.toBeInTheDocument();
		expect(screen.getByText('Local Edit')).toBeInTheDocument();
	});

	it('offline-created note remains visible after reconnect when sync fails', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		// Server does NOT know about the offline-created note yet (sync failed)
		vi.mocked(api.notes.list).mockResolvedValue([]);
		vi.mocked(syncOfflineChanges).mockResolvedValue(emptySyncResult);
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([
			{ id: -123, title: 'Offline Created', body: 'Only in IDB', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z',
			  is_dirty: true, is_new: true },
		]);
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: -123, title: 'Offline Created', body: 'Only in IDB', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z',
			  is_dirty: true, is_new: true },
		]);

		render(Page);
		await waitFor(() => expect(screen.getByText('Offline Created')).toBeInTheDocument());

		window.dispatchEvent(new Event('online'));

		// Wait for all reconnect work
		await waitFor(() => expect(syncOfflineChanges).toHaveBeenCalled());
		await waitFor(() => expect(api.notes.list).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 50));

		// The offline-created note should still be visible
		expect(screen.getByText('Offline Created')).toBeInTheDocument();
	});

	it('heartbeat is bidirectional — runs syncOfflineChanges and then api.notes.list', async () => {
		// Coming online triggers a sync. The sync should call BOTH the sync
		// function (push) AND api.notes.list (pull) so server-side changes on
		// OTHER devices appear without a force-refresh.
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.list).mockResolvedValue([]);
		vi.mocked(syncOfflineChanges).mockResolvedValue(emptySyncResult);

		render(Page);

		// Initial mount already loads notes; clear the spy history and trigger online.
		await waitFor(() => expect(api.notes.list).toHaveBeenCalled());
		vi.mocked(api.notes.list).mockClear();
		vi.mocked(syncOfflineChanges).mockClear();

		window.dispatchEvent(new Event('online'));

		await waitFor(() => expect(syncOfflineChanges).toHaveBeenCalledWith('online'));
		await waitFor(() => expect(api.notes.list).toHaveBeenCalled());
	});

	it('clicking the sync status indicator triggers a manual sync', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.list).mockResolvedValue([]);
		vi.mocked(syncOfflineChanges).mockResolvedValue(emptySyncResult);

		render(Page);
		await waitFor(() => expect(api.notes.list).toHaveBeenCalled());
		vi.mocked(syncOfflineChanges).mockClear();

		// The indicator is the only button whose aria-label mentions "sync"
		const syncBtn = await waitFor(() =>
			screen.getByRole('button', { name: /sync/i })
		);
		await fireEvent.click(syncBtn);

		await waitFor(() => expect(syncOfflineChanges).toHaveBeenCalledWith('manual'));
	});
});
