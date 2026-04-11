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
vi.mock('$lib/components/Editor.svelte', async () => ({
	default: (anchor: unknown, props: unknown) => { void anchor; void props; },
}));

// Override the page store to supply a real note id in params
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({
			params: { id: '42' },
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

vi.mock('$lib/api', () => ({
	api: {
		notes: { get: vi.fn(), update: vi.fn() },
		tags: {
			list: vi.fn(),
			listForNote: vi.fn(),
			addToNote: vi.fn(),
			removeFromNote: vi.fn(),
			create: vi.fn(),
		},
	},
}));

import { api } from '$lib/api';
import { goto } from '$app/navigation';

const mockNote = (overrides = {}) => ({
	id: 42, title: 'My Note', body: '# Hello',
	starred: false, pinned: false, archived: false,
	created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.notes.get).mockResolvedValue(mockNote());
	vi.mocked(api.tags.listForNote).mockResolvedValue([]);
	vi.mocked(api.tags.list).mockResolvedValue([]);
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

		// Auto-save fires after 800 ms debounce
		vi.advanceTimersByTime(800);
		await waitFor(() =>
			expect(api.notes.update).toHaveBeenCalledWith(42, { title: 'New Title' })
		);
		vi.useRealTimers();
	});

	it('renders the formatting toolbar', async () => {
		render(NotePage);
		await waitFor(() =>
			expect(screen.getByRole('toolbar', { name: /formatting/i })).toBeInTheDocument()
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

		expect(screen.getByPlaceholderText(/https/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
	});

	it('pressing Escape closes the dialog', async () => {
		render(NotePage);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		const input = screen.getByPlaceholderText(/https/i);

		await fireEvent.keyDown(input, { key: 'Escape' });

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('clicking the backdrop closes the dialog', async () => {
		render(NotePage);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		expect(screen.getByPlaceholderText(/https/i)).toBeInTheDocument();

		await fireEvent.click(document.querySelector('.link-dialog-backdrop')!);

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('pressing Enter in the URL input closes the dialog', async () => {
		render(NotePage);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		const input = screen.getByPlaceholderText(/https/i);
		await fireEvent.input(input, { target: { value: 'https://example.com' } });

		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});

	it('clicking Apply closes the dialog', async () => {
		render(NotePage);
		await waitFor(() => screen.getByTitle('Insert link (Ctrl+K)'));

		await fireEvent.click(screen.getByTitle('Insert link (Ctrl+K)'));
		await fireEvent.click(screen.getByRole('button', { name: /apply/i }));

		expect(screen.queryByPlaceholderText(/https/i)).not.toBeInTheDocument();
	});
});
