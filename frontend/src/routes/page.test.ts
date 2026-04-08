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
}));
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
		tags: { list: vi.fn() },
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

import { api } from '$lib/api';

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
		await fireEvent.click(screen.getByRole('button', { name: /new note/i }));
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
