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
			reorderPins: vi.fn(),
		},
		tags: { list: vi.fn(), listForNote: vi.fn().mockResolvedValue([]) },
		auth: { logout: vi.fn() },
	},
};
});

vi.mock('$lib/stores/auth.svelte', () => ({
	auth: {
		user: { id: 1, username: 'alice', is_admin: false, created_at: '' },
		loading: false,
		logout: vi.fn(),
		// The page awaits this before it touches the offline store, so every
		// test needs it. Resolved by default = "auth already settled".
		ready: vi.fn().mockResolvedValue(undefined),
	},
}));

// The offline-store ownership gate. Resolving to a handle is the "this
// browser's cache belongs to the signed-in user" case that every other test
// assumes; the guard tests override it with null.
vi.mock('$lib/localData', () => ({
	openOwnedOfflineDB: vi.fn().mockResolvedValue({ close: vi.fn() }),
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

vi.mock('$lib/offlineActions', () => ({
	markNoteDeletedOffline: vi.fn().mockResolvedValue(undefined),
	markNoteArchivedOffline: vi.fn().mockResolvedValue(undefined),
	markNoteFlagsOffline: vi.fn().mockResolvedValue(undefined),
}));

// Only the IndexedDB entry points are stubbed; pure helpers (noteFlags) stay
// real, since mocking them would hide the field-drop bugs they prevent.
vi.mock('$lib/offlineDB', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/offlineDB')>()),
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
	pushed: { created: 0, updated: 0, deleted: 0, archived: 0, flags: 0 },
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
		pushed: { created: 0, updated: 0, deleted: 0, archived: 0, flags: 0 },
		conflicts: 0,
		errors: 0,
		skipped: false,
	}),
}));


import { api, OfflineError } from '$lib/api';
import * as offlineDB from '$lib/offlineDB';
import { markNoteDeletedOffline, markNoteArchivedOffline, markNoteFlagsOffline } from '$lib/offlineActions';
import { syncOfflineChanges } from '$lib/offlineSync';
import { auth } from '$lib/stores/auth.svelte';
import { openOwnedOfflineDB } from '$lib/localData';

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

	it('renders preview links underlined and unbracketed', async () => {
		vi.mocked(api.notes.list).mockResolvedValue([
			mockNote({
				id: 9,
				title: 'Exam guide',
				body: '<https://example.com/guide.pdf>\n',
			}),
		]);

		const { container } = render(Page);
		await waitFor(() => screen.getByText('Exam guide'));

		const preview = container.querySelector('li.note-item .note-preview');
		expect(preview?.textContent).toBe('https://example.com/guide.pdf');
		expect(preview?.querySelector('.preview-link')?.textContent).toBe(
			'https://example.com/guide.pdf',
		);
		// Preview links are indicators, not navigation.
		expect(preview?.querySelector('a')).toBeNull();
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

	it('shows a trash nav link in the sidebar bottom', async () => {
		render(Page);
		await waitFor(() => {
			const trashLink = screen.getByTitle('Trash');
			expect(trashLink.getAttribute('href')).toBe('/trash');
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

	it('deletes a note offline: queues the replay and removes it from the list', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 3, title: 'Doomed Note', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: false, is_new: false },
		]);

		render(Page);
		await waitFor(() => screen.getByText('Doomed Note'));

		const item = screen.getByText('Doomed Note').closest('.note-item') as HTMLElement;
		const del = item.querySelector('[title="Delete"]') as HTMLButtonElement;
		await fireEvent.click(del);

		await waitFor(() => expect(markNoteDeletedOffline).toHaveBeenCalledWith(
			expect.objectContaining({ id: 3 })
		));
		expect(api.notes.delete).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByText('Doomed Note')).not.toBeInTheDocument());
	});

	it('archives a note offline: queues the replay and removes it from the list', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 4, title: 'Shelved Note', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: false, is_new: false },
		]);

		render(Page);
		await waitFor(() => screen.getByText('Shelved Note'));

		const archiveBtn = await waitFor(() => screen.getByRole('button', { name: /move to archive/i }));
		await fireEvent.click(archiveBtn);

		await waitFor(() => expect(markNoteArchivedOffline).toHaveBeenCalledWith(
			expect.objectContaining({ id: 4 })
		));
		expect(api.notes.archive).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByText('Shelved Note')).not.toBeInTheDocument());
	});

	it('hides notes flagged deleted_offline or archived_offline from the cached list', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 1, title: 'Visible Note', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: false, is_new: false },
			{ id: 2, title: 'Deleted Pending', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: true, is_new: false, deleted_offline: true },
			{ id: 3, title: 'Archived Pending', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: true, is_new: false, archived_offline: true },
		]);

		render(Page);
		await waitFor(() => screen.getByText('Visible Note'));
		expect(screen.queryByText('Deleted Pending')).not.toBeInTheDocument();
		expect(screen.queryByText('Archived Pending')).not.toBeInTheDocument();
	});

	it('starring a note offline applies optimistically and queues the desired state', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 6, title: 'Starrable Note', body: '', starred: false, pinned: false, tags: [],
			  server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: false, is_new: false },
		]);
		vi.mocked(api.notes.toggleStar).mockRejectedValue(new OfflineError());

		render(Page);
		await waitFor(() => screen.getByText('Starrable Note'));

		const item = screen.getByText('Starrable Note').closest('.note-item') as HTMLElement;
		await fireEvent.click(item.querySelector('[aria-label="Star note"]') as HTMLElement);

		await waitFor(() => expect(markNoteFlagsOffline).toHaveBeenCalledWith(
			expect.objectContaining({ id: 6, starred: true }),
			'starred'
		));
	});

	it('pinning a note offline sends it to the top of the pinned group', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		const cached = (id: number, title: string, pinned: boolean, pin_order?: number) => ({
			id, title, body: '', starred: false, pinned, pin_order, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			is_dirty: false, is_new: false,
		});
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			cached(6, 'Already Pinned', true, -2),
			cached(7, 'Pin Me Offline', false),
		]);
		vi.mocked(api.notes.togglePin).mockRejectedValue(new OfflineError());

		render(Page);
		await waitFor(() => screen.getByText('Pin Me Offline'));

		const item = screen.getByText('Pin Me Offline').closest('.note-item') as HTMLElement;
		await fireEvent.click(item.querySelector('[aria-label="Pin note"]') as HTMLElement);

		// Without a locally-assigned slot it would keep pin_order 0 and sort
		// below the note pinned earlier online.
		await waitFor(() => expect(markNoteFlagsOffline).toHaveBeenCalledWith(
			expect.objectContaining({ id: 7, pinned: true, pin_order: -3 }),
			'pinned'
		));
		const titles = Array.from(document.querySelectorAll('li.note-item .note-title')).map(
			(el) => el.textContent
		);
		expect(titles).toEqual(['Pin Me Offline', 'Already Pinned']);
	});

	it('keeps an offline pin at the top when the server list lands before sync', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		// Pinned offline (flags_dirty, client-assigned slot), but the server
		// still reports it unpinned at pin_order 0.
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ id: 7, title: 'Pinned Offline', body: '', starred: false, pinned: true, pin_order: -3,
			  tags: [], server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			  is_dirty: false, is_new: false, flags_dirty: true, flags_toggled: { pinned: true } },
		]);
		vi.mocked(api.notes.list).mockResolvedValue([
			mockNote({ id: 6, title: 'Pinned Online', pinned: true, pin_order: -1 }),
			mockNote({ id: 7, title: 'Pinned Offline', pinned: false, pin_order: 0 }),
		]);

		render(Page);
		await waitFor(() => screen.getByText('Pinned Offline'));

		await waitFor(() => {
			const titles = Array.from(document.querySelectorAll('li.note-item .note-title')).map(
				(el) => el.textContent
			);
			expect(titles).toEqual(['Pinned Offline', 'Pinned Online']);
		});
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

describe('pinned note reordering', () => {
	const pinnedFixture = [
		mockNote({ id: 1, title: 'Alpha', pinned: true, pin_order: 0 }),
		mockNote({ id: 2, title: 'Beta', pinned: true, pin_order: 1 }),
		mockNote({ id: 3, title: 'Gamma', pinned: true, pin_order: 2 }),
		mockNote({ id: 9, title: 'Plain', pinned: false }),
	];

	/** Titles in the rendered list, top first. */
	function renderedTitles(container: HTMLElement): string[] {
		return Array.from(container.querySelectorAll('li.note-item .note-title')).map(
			(el) => el.textContent ?? ''
		);
	}

	function handles(container: HTMLElement): HTMLElement[] {
		return Array.from(container.querySelectorAll<HTMLElement>('.pin-drag-handle'));
	}

	/** Rows report a fixed 40px height so the drop maths is predictable. */
	function stubRowGeometry(container: HTMLElement) {
		container.querySelectorAll<HTMLElement>('li.note-item.pinned').forEach((row, i) => {
			row.getBoundingClientRect = () =>
				({ top: i * 40, bottom: i * 40 + 40, height: 40, left: 0, right: 100, width: 100,
					x: 0, y: i * 40, toJSON: () => ({}) }) as DOMRect;
		});
	}

	function touch(type: string, clientY: number): TouchEvent {
		// jsdom has no TouchEvent/Touch constructors; the handlers only read
		// touches[0].clientX/clientY.
		const e = new Event(type, { bubbles: true, cancelable: true });
		Object.defineProperty(e, 'touches', { value: [{ clientX: 0, clientY }] });
		return e as unknown as TouchEvent;
	}

	function pointer(type: string, clientY: number): PointerEvent {
		// jsdom has no PointerEvent constructor; MouseEvent carries what the
		// handlers actually read (button, clientY, pointerId is optional).
		const e = new MouseEvent(type, { bubbles: true, button: 0, clientY });
		Object.defineProperty(e, 'pointerId', { value: 1 });
		return e as unknown as PointerEvent;
	}

	beforeEach(() => {
		// clearAllMocks wipes calls but not implementations, so an offline-note
		// fixture left by an earlier test would still merge into this list.
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([]);
		vi.mocked(api.notes.list).mockResolvedValue(pinnedFixture);
		vi.mocked(api.notes.reorderPins).mockResolvedValue(undefined);
	});

	it('offers a drag handle on pinned notes only', async () => {
		const { container } = render(Page);
		await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());

		expect(handles(container)).toHaveLength(3);
		const plain = Array.from(container.querySelectorAll('li.note-item')).find((li) =>
			li.textContent?.includes('Plain')
		);
		expect(plain?.querySelector('.pin-drag-handle')).toBeNull();
	});

	it('reorders the list and persists the new order', async () => {
		const { container } = render(Page);
		await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());
		stubRowGeometry(container);

		// Drag Gamma (third pinned row) up above Alpha.
		const grip = handles(container)[2];
		await fireEvent(grip, pointer('pointerdown', 90));
		await fireEvent(grip, pointer('pointermove', 5));
		await fireEvent(grip, pointer('pointerup', 5));

		await waitFor(() =>
			expect(renderedTitles(container)).toEqual(['Gamma', 'Alpha', 'Beta', 'Plain'])
		);
		expect(api.notes.reorderPins).toHaveBeenCalledWith([3, 1, 2]);
	});

	it('leaves the order alone when the note is dropped where it started', async () => {
		const { container } = render(Page);
		await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());
		stubRowGeometry(container);

		const grip = handles(container)[0];
		await fireEvent(grip, pointer('pointerdown', 10));
		await fireEvent(grip, pointer('pointermove', 10));
		await fireEvent(grip, pointer('pointerup', 10));

		expect(api.notes.reorderPins).not.toHaveBeenCalled();
		expect(renderedTitles(container)).toEqual(['Alpha', 'Beta', 'Gamma', 'Plain']);
	});

	it('does not pull-to-sync while a pinned note is being dragged', async () => {
		const { container } = render(Page);
		await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());
		stubRowGeometry(container);

		const list = container.querySelector('ul.note-list') as HTMLElement;
		const indicator = container.querySelector('.mob-pull-indicator') as HTMLElement;

		// Dragging the top pinned note downwards is a reorder, so the sync
		// banner must stay shut even though the finger travels down from the
		// top of an unscrolled list.
		const grip = handles(container)[0];
		await fireEvent(grip, pointer('pointerdown', 10));
		await fireEvent(list, touch('touchstart', 10));
		await fireEvent(grip, pointer('pointermove', 150));
		await fireEvent(list, touch('touchmove', 150));

		expect(indicator.style.height).toBe('0px');

		await fireEvent(grip, pointer('pointerup', 150));
		await fireEvent(list, touch('touchend', 150));
		expect(syncOfflineChanges).not.toHaveBeenCalled();
	});

	it('still pulls to sync when no note is being dragged', async () => {
		const { container } = render(Page);
		await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());

		const list = container.querySelector('ul.note-list') as HTMLElement;
		const indicator = container.querySelector('.mob-pull-indicator') as HTMLElement;

		await fireEvent(list, touch('touchstart', 10));
		await fireEvent(list, touch('touchmove', 150));

		expect(parseFloat(indicator.style.height)).toBeGreaterThan(0);
	});

	it('hides the drag handle while a filter narrows the list', async () => {
		const { container } = render(Page);
		await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());
		expect(handles(container)).toHaveLength(3);

		// A filtered list only shows some of the pinned notes, so a drag could
		// only ever send a partial order.
		vi.mocked(api.notes.list).mockResolvedValue([pinnedFixture[0], pinnedFixture[2]]);
		const searchBox = screen.getByPlaceholderText(/search/i);
		await fireEvent.input(searchBox, { target: { value: 'a' } });

		// Wait for the filtered list to settle before judging the handles.
		await waitFor(() => expect(screen.queryByText('Beta')).not.toBeInTheDocument());
		await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());
		expect(handles(container)).toHaveLength(0);
	});

	it('rolls the list back when saving the order fails', async () => {
		vi.mocked(api.notes.reorderPins).mockRejectedValue(new Error('boom'));
		const { container } = render(Page);
		await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());
		stubRowGeometry(container);

		const grip = handles(container)[2];
		await fireEvent(grip, pointer('pointerdown', 90));
		await fireEvent(grip, pointer('pointermove', 5));
		await fireEvent(grip, pointer('pointerup', 5));

		await waitFor(() => expect(api.notes.reorderPins).toHaveBeenCalled());
		await waitFor(() =>
			expect(renderedTitles(container)).toEqual(['Alpha', 'Beta', 'Gamma', 'Plain'])
		);
	});

	it('scrolls the list when a drag reaches its top edge', async () => {
		const { container } = render(Page);
		await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());
		stubRowGeometry(container);

		// A list taller than its viewport, scrolled part-way down.
		const list = container.querySelector('ul.note-list') as HTMLElement;
		list.getBoundingClientRect = () =>
			({ top: 0, bottom: 300, height: 300, left: 0, right: 200, width: 200,
				x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
		Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true });
		Object.defineProperty(list, 'scrollHeight', { value: 900, configurable: true });
		list.style.overflowY = 'auto';
		list.scrollTop = 400;

		// Frames are pumped by hand so the assertion doesn't race a real rAF.
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
			frames.push(cb);
			return frames.length;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});

		const grip = handles(container)[2];
		await fireEvent(grip, pointer('pointerdown', 90));
		// Held right at the top edge of the scroller.
		await fireEvent(grip, pointer('pointermove', 2));

		expect(frames.length).toBeGreaterThan(0);
		frames.shift()!(0);

		expect(list.scrollTop).toBeLessThan(400);

		await fireEvent(grip, pointer('pointerup', 2));
		vi.unstubAllGlobals();
	});
});

/**
 * Read-path ownership gate (issue #61).
 *
 * The offline store outlives a session: `clearLocalData()` only runs on an
 * explicit logout, so a browser that was merely closed still holds the last
 * user's note titles and bodies. Nothing may reach the DOM from it until we
 * know who is looking — the live session when online, the identity remembered
 * at the last login when offline — and that the store belongs to them.
 */
describe('offline cache ownership guard', () => {
	const cachedNote = (title: string) => ({
		id: 1, title, body: 'Confidential body', starred: false, pinned: false, tags: [],
		server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
		is_dirty: false, is_new: false,
	});

	beforeEach(() => {
		vi.mocked(openOwnedOfflineDB).mockResolvedValue({ close: vi.fn() } as unknown as IDBDatabase);
		vi.mocked(auth.ready).mockResolvedValue(undefined);
	});

	/** Resolves once the mount-time list load has run to completion, so a
	 * "nothing rendered" assertion can't pass merely by being early. */
	async function listLoadSettled() {
		await waitFor(() => expect(api.tags.list).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 20));
	}

	it('renders nothing from a store owned by someone else', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(openOwnedOfflineDB).mockResolvedValue(null);
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([cachedNote("Previous user's note")]);

		render(Page);
		await listLoadSettled();

		expect(screen.queryByText("Previous user's note")).not.toBeInTheDocument();
		expect(screen.queryByText(/Confidential body/)).not.toBeInTheDocument();
	});

	it('reads nothing from a store owned by someone else', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(openOwnedOfflineDB).mockResolvedValue(null);
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([cachedNote("Previous user's note")]);

		render(Page);
		await listLoadSettled();

		// Belt and braces: the rows must not even be fetched out of IDB, so a
		// future consumer of the list can't leak them some other way.
		expect(offlineDB.getAllNotes).not.toHaveBeenCalled();
	});

	it('renders cached notes for the user the store belongs to', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([cachedNote('My own note')]);

		render(Page);

		await waitFor(() => expect(screen.getByText('My own note')).toBeInTheDocument());
	});

	it('checks ownership against the resolved user, not the one present at mount', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([cachedNote('Late-checked note')]);
		let settleAuth!: () => void;
		vi.mocked(auth.ready).mockReturnValue(new Promise<void>((r) => { settleAuth = () => r(); }));

		render(Page);

		// Nothing may paint while the session is still unknown: a flash of the
		// previous user's titles is the leak, not just a steady-state render.
		await new Promise((r) => setTimeout(r, 20));
		expect(screen.queryByText('Late-checked note')).not.toBeInTheDocument();

		settleAuth();
		await waitFor(() => expect(screen.getByText('Late-checked note')).toBeInTheDocument());
	});

	it('does not write freshly fetched notes into a store owned by someone else', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
		vi.mocked(openOwnedOfflineDB).mockResolvedValue(null);
		vi.mocked(api.notes.list).mockResolvedValue([mockNote({ id: 5, title: 'Online Note' })]);

		render(Page);
		await waitFor(() => screen.getByText('Online Note'));
		await listLoadSettled();

		// Caching into a foreign store would let the guard hand this user's
		// notes straight back to that store's owner.
		expect(offlineDB.upsertNote).not.toHaveBeenCalled();
		expect(offlineDB.deleteNote).not.toHaveBeenCalled();
	});

	it('does not rebuild the tag list from a foreign store', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });
		vi.mocked(openOwnedOfflineDB).mockResolvedValue(null);
		vi.mocked(offlineDB.getAllNotes).mockResolvedValue([
			{ ...cachedNote('Some note'), tags: [{ id: 3, name: 'private-tag' }] },
		]);
		// /api/tags is unreachable, so the sidebar falls back to the tag names
		// cached on the offline notes — another read of the same store.
		vi.mocked(api.tags.list).mockRejectedValue(new OfflineError());

		render(Page);
		await listLoadSettled();

		expect(offlineDB.getAllNotes).not.toHaveBeenCalled();
	});
});
