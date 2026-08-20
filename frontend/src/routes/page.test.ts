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
	wrapInHeadingCommand: { key: 'WrapInHeading' },
}));

vi.mock('$lib/milkdown/link', () => ({ linkPlugin: [] }));
vi.mock('$lib/milkdown/tasklist', () => ({
	wrapInTaskListCommand: { key: 'WrapInTaskList' },
	taskListItemView: {},
	taskListPlugin: [],
}));
vi.mock('@milkdown/kit/preset/gfm', () => ({ gfm: [] }));
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
			toggleLock: vi.fn(),
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

vi.mock('$lib/components/MobileTabBar.svelte', () => ({
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
		matches: mobile && query === '(max-width: 640px)',
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
	starred: false, pinned: false, archived: false, locked: false,
	created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.notes.list).mockResolvedValue([mockNote()]);
	vi.mocked(api.tags.list).mockResolvedValue([]);
});

async function focusEditor() {
	// Wait for the title input — it's inside the focus zone and only rendered when a note is selected
	const titleInput = await waitFor(() => screen.getByPlaceholderText(/note title/i));
	// focusin on the title input bubbles up to the .editor-focus-zone parent
	await fireEvent.focusIn(titleInput);
	await waitFor(() => expect(screen.getByRole('toolbar', { name: /formatting/i })).toBeInTheDocument());
}

describe('Notes page', () => {
	it('renders the app title', async () => {
		render(Page);
		await waitFor(() => expect(screen.getAllByText('Crapnote').length).toBeGreaterThan(0));
	});

	it('shows the note list after load', async () => {
		render(Page);
		await waitFor(() => expect(screen.getByText('Test Note')).toBeInTheDocument());
	});

	it('shows new note button', async () => {
		render(Page);
		await waitFor(() => expect(screen.getAllByRole('button', { name: /new note/i }).length).toBeGreaterThan(0));
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

	it('toolbar is visible when a note is selected', async () => {
		render(Page);
		await waitFor(() => screen.getByText('Test Note'));
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
			{ id: 99, title: '', body: '', starred: false, pinned: false, archived: false, locked: false,
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
		await focusEditor();
		expect(screen.getByTitle('Insert link (Ctrl+K)')).toBeInTheDocument();
	});

	it('clicking the link button shows the URL input dialog', async () => {
		render(Page);
		await focusEditor();

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));

		expect(screen.getByPlaceholderText(/https/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
	});

	it('pressing Escape closes the dialog', async () => {
		render(Page);
		await focusEditor();

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		const input = screen.getByPlaceholderText(/https/i);

		await fireEvent.keyDown(input, { key: 'Escape' });

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('clicking the backdrop closes the dialog', async () => {
		render(Page);
		await focusEditor();

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		expect(screen.getByPlaceholderText(/https/i)).toBeInTheDocument();

		await fireEvent.click(document.querySelector('.link-dialog-backdrop')!);

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('pressing Enter in the URL input closes the dialog', async () => {
		render(Page);
		await focusEditor();

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		const input = screen.getByPlaceholderText(/https/i);
		await fireEvent.input(input, { target: { value: 'https://example.com' } });

		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('clicking Apply closes the dialog', async () => {
		render(Page);
		await focusEditor();

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		await fireEvent.click(screen.getByRole('button', { name: /apply/i }));

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});
});

describe('Headings toolbar group', () => {
	it('shows a Headings toggle button when editor is focused', async () => {
		render(Page);
		await focusEditor();
		expect(screen.getByTitle('Headings')).toBeInTheDocument();
	});

	it('H1/H2/H3 buttons are hidden before toggling', async () => {
		render(Page);
		await focusEditor();
		expect(screen.queryByTitle('Heading 1')).not.toBeInTheDocument();
		expect(screen.queryByTitle('Heading 2')).not.toBeInTheDocument();
		expect(screen.queryByTitle('Heading 3')).not.toBeInTheDocument();
	});

	it('clicking Headings toggle reveals H1, H2, H3 buttons', async () => {
		render(Page);
		await focusEditor();
		await fireEvent.click(screen.getByTitle('Headings'));
		expect(screen.getByTitle('Heading 1')).toBeInTheDocument();
		expect(screen.getByTitle('Heading 2')).toBeInTheDocument();
		expect(screen.getByTitle('Heading 3')).toBeInTheDocument();
	});

	it('clicking H1 closes the heading group', async () => {
		render(Page);
		await focusEditor();
		await fireEvent.click(screen.getByTitle('Headings'));
		await fireEvent.click(screen.getByTitle('Heading 1'));
		await waitFor(() => expect(screen.queryByTitle('Heading 1')).not.toBeInTheDocument());
	});
});

describe('Checklist toolbar button', () => {
	it('shows a Task list button in the toolbar when editor is focused', async () => {
		render(Page);
		await focusEditor();
		expect(screen.getByTitle('Task list')).toBeInTheDocument();
	});

	it('Task list button is clickable without error', async () => {
		render(Page);
		await focusEditor();
		await fireEvent.click(screen.getByTitle('Task list'));
	});
});

describe('Typemark (home link)', () => {
	it('clicking the typemark resets the search term', async () => {
		render(Page);
		await waitFor(() => screen.getByText('Test Note'));
		const searchInputs = screen.getAllByPlaceholderText(/search/i);
		const searchInput = searchInputs[searchInputs.length - 1]; // desktop search is last in DOM
		await fireEvent.input(searchInput, { target: { value: 'my search' } });
		await fireEvent.click(screen.getAllByRole('link', { name: /crapnote/i })[0]);
		await waitFor(() => expect((searchInput as HTMLInputElement).value).toBe(''));
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
			expect(screen.getAllByRole('button', { name: /^all/i }).length).toBeGreaterThan(0);
			expect(screen.getAllByRole('button', { name: /^starred/i }).length).toBeGreaterThan(0);
			expect(screen.getAllByRole('button', { name: /^tags/i }).length).toBeGreaterThan(0);
		});
	});

	it('clicking the Tags tab reveals the tag panel', async () => {
		render(Page);
		await waitFor(() => screen.getAllByRole('button', { name: /^tags/i }));

		await fireEvent.click(screen.getAllByRole('button', { name: /^tags/i })[0]);

		await waitFor(() => {
			expect(screen.getByRole('group', { name: /tag filters/i })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /alpha/i })).toBeInTheDocument();
		});
	});

	it('clicking All tab hides the tag panel', async () => {
		render(Page);
		await waitFor(() => screen.getAllByRole('button', { name: /^tags/i }));

		await fireEvent.click(screen.getAllByRole('button', { name: /^tags/i })[0]);
		await waitFor(() => screen.getByRole('group', { name: /tag filters/i }));

		await fireEvent.click(screen.getAllByRole('button', { name: /^all/i })[0]);

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
		await waitFor(() => expect(screen.getAllByText(/offline/i).length).toBeGreaterThan(0));
	});

	// navigator.onLine being true is not enough — the server can still be
	// unreachable (DNS failure, captive portal, app server down, etc.). The
	// sync status row used to keep saying "SYNCED" in that case; loadNotes
	// now flips isOnline based on whether the API actually replied.
	it('shows OFFLINE when navigator.onLine is true but the API is unreachable', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.list).mockRejectedValue(new Error('network'));
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 1, title: 'Cached Note', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: false, is_new: false },
		]);

		render(Page);
		await waitFor(() => expect(screen.getAllByText(/offline/i).length).toBeGreaterThan(0));
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

	// Cold PWA start in airplane mode used to leave the list empty until the
	// network attempt failed. The cached notes must paint immediately, before
	// the (slow or doomed) network request settles.
	it('paints cached notes immediately while the network list is still pending', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		let resolveList!: (notes: ReturnType<typeof mockNote>[]) => void;
		vi.mocked(api.notes.list).mockReturnValue(new Promise((r) => { resolveList = r; }));
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 1, title: 'Instant Cached Note', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: false, is_new: false },
		]);

		render(Page);
		// Cached note appears while api.notes.list is still pending
		await waitFor(() => expect(screen.getByText('Instant Cached Note')).toBeInTheDocument());

		// When the server finally answers, its list replaces the cached paint
		resolveList([mockNote({ id: 9, title: 'Fresh Server Note' })]);
		await waitFor(() => expect(screen.getByText('Fresh Server Note')).toBeInTheDocument());
	});

	it('caches notes to IndexedDB after a successful online load', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(api.notes.list).mockResolvedValue([
			{ id: 5, title: 'Online Note', body: '', starred: false, pinned: false,
			  archived: false, locked: false, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
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
			  archived: false, locked: false, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
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
			  archived: false, locked: false, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
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

		await waitFor(() => expect(syncOfflineChanges).toHaveBeenCalledWith('online', 1));
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
			screen.getAllByRole('button', { name: /sync/i })[0]
		);
		await fireEvent.click(syncBtn);

		await waitFor(() => expect(syncOfflineChanges).toHaveBeenCalledWith('manual', 1));
	});
});

describe('Note locking', () => {
	// Earlier blocks stub a mobile viewport globally; the lock control lives in
	// the desktop editor toolbar.
	beforeEach(() => mockViewport(false));

	/**
	 * Render and open "Test Note" in the desktop editor pane. Selects by title
	 * rather than by position — earlier tests leave offline-created notes in the
	 * fake IndexedDB, which the cache merge prepends to the list.
	 */
	async function openNote() {
		render(Page);
		const label = await waitFor(() => screen.getByText('Test Note'));
		const noteBtn = label.closest('.note-btn') as HTMLElement | null;
		await fireEvent.click(noteBtn ?? label);
		await waitFor(() => screen.getByPlaceholderText(/note title/i));
	}

	it('shows a lock control for the selected note', async () => {
		await openNote();

		expect(screen.getByTitle('Lock note')).toBeTruthy();
	});

	it('locks a note through the API and reflects the new state', async () => {
		vi.mocked(api.notes.toggleLock).mockResolvedValue(mockNote({ locked: true }));

		await openNote();

		await fireEvent.click(screen.getByTitle('Lock note'));

		await waitFor(() => expect(api.notes.toggleLock).toHaveBeenCalledWith(1));
		await waitFor(() => expect(screen.getByTitle('Unlock note')).toBeTruthy());
	});

	it('makes the title read-only while the note is locked', async () => {
		vi.mocked(api.notes.list).mockResolvedValue([mockNote({ locked: true })]);

		await openNote();

		const title = screen.getByPlaceholderText(/note title/i);
		expect((title as HTMLInputElement).readOnly).toBe(true);
	});

	it('does not save edits made to a locked note', async () => {
		vi.mocked(api.notes.list).mockResolvedValue([mockNote({ locked: true })]);

		await openNote();
		const title = screen.getByPlaceholderText(/note title/i);

		vi.useFakeTimers();
		await fireEvent.input(title, { target: { value: 'changed' } });
		await vi.advanceTimersByTimeAsync(1000); // well past the 800ms debounce

		expect(api.notes.update).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('unlocking restores editing', async () => {
		vi.mocked(api.notes.list).mockResolvedValue([mockNote({ locked: true })]);
		vi.mocked(api.notes.toggleLock).mockResolvedValue(mockNote({ locked: false }));

		await openNote();

		await fireEvent.click(screen.getByTitle('Unlock note'));

		await waitFor(() => expect(api.notes.toggleLock).toHaveBeenCalledWith(1));
		const title = await waitFor(() => screen.getByPlaceholderText(/note title/i));
		await waitFor(() => expect((title as HTMLInputElement).readOnly).toBe(false));
	});
});

describe('Lock controls in the note list', () => {
	beforeEach(() => mockViewport(false));

	function row() {
		return screen.getByText('Test Note').closest('.note-row-body') as HTMLElement;
	}

	it('offers a lock action on hover for an unlocked note', async () => {
		render(Page);
		await waitFor(() => screen.getByText('Test Note'));
		vi.mocked(api.notes.toggleLock).mockResolvedValue(mockNote({ locked: true }));

		const lockBtn = row().querySelector('.note-hover-actions [title="Lock"]') as HTMLElement;
		expect(lockBtn).toBeTruthy();

		await fireEvent.click(lockBtn);
		await waitFor(() => expect(api.notes.toggleLock).toHaveBeenCalledWith(1));
	});

	it('marks a locked note with a lock icon that unlocks it', async () => {
		vi.mocked(api.notes.list).mockResolvedValue([mockNote({ locked: true })]);
		vi.mocked(api.notes.toggleLock).mockResolvedValue(mockNote({ locked: false }));

		render(Page);
		await waitFor(() => screen.getByText('Test Note'));

		const indicator = row().querySelector('.note-meta-icons [title="Unlock"]') as HTMLElement;
		expect(indicator).toBeTruthy();

		await fireEvent.click(indicator);
		await waitFor(() => expect(api.notes.toggleLock).toHaveBeenCalledWith(1));
	});

	it('does not show a lock indicator on an unlocked note', async () => {
		render(Page);
		await waitFor(() => screen.getByText('Test Note'));

		expect(row().querySelector('.note-meta-icons [title="Unlock"]')).toBeNull();
	});

	// Deleting a locked note is rejected by the API with 423.
	it('disables delete in the hover actions while a note is locked', async () => {
		vi.mocked(api.notes.list).mockResolvedValue([mockNote({ locked: true })]);

		render(Page);
		await waitFor(() => screen.getByText('Test Note'));

		const del = row().querySelector('.note-hover-actions [title="Delete"]') as HTMLButtonElement;
		expect(del.disabled).toBe(true);
	});

	it('offers lock alongside pin and star in the mobile swipe panel', async () => {
		render(Page);
		await waitFor(() => screen.getByText('Test Note'));
		vi.mocked(api.notes.toggleLock).mockResolvedValue(mockNote({ locked: true }));

		const item = screen.getByText('Test Note').closest('.note-item') as HTMLElement;
		const panel = item.querySelector('.mob-swipe-left') as HTMLElement;
		const labels = [...panel.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
		expect(labels).toEqual(['Pin note', 'Star note', 'Lock note']);

		await fireEvent.click(panel.querySelector('.mob-swipe-lock') as HTMLElement);
		await waitFor(() => expect(api.notes.toggleLock).toHaveBeenCalledWith(1));
	});
});
