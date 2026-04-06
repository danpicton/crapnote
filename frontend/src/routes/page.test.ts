import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from './+page.svelte';

vi.mock('$lib/api', () => ({
	api: {
		notes: {
			list: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			toggleStar: vi.fn(),
			togglePin: vi.fn(),
		},
		tags: {
			list: vi.fn(),
		},
		auth: {
			logout: vi.fn(),
		},
	},
}));

vi.mock('$lib/stores/auth.svelte', () => ({
	auth: {
		user: { id: 1, username: 'alice', is_admin: false, created_at: '' },
		loading: false,
		logout: vi.fn(),
	},
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
}));

// Milkdown uses browser APIs not available in jsdom; stub with an empty div
vi.mock('$lib/components/Editor.svelte', async () => {
	const { mount } = await import('svelte');
	return {
		default: (anchor: unknown, props: unknown) => {
			// No-op stub
			void anchor; void props;
		},
	};
});

import { api } from '$lib/api';

const mockNote = (overrides = {}) => ({
	id: 1,
	title: 'Test Note',
	body: '# Hello',
	starred: false,
	pinned: false,
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
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
		await waitFor(() => {
			expect(screen.getByText('CrapNote')).toBeInTheDocument();
		});
	});

	it('shows the note list after load', async () => {
		render(Page);
		await waitFor(() => {
			expect(screen.getByText('Test Note')).toBeInTheDocument();
		});
	});

	it('shows new note button', async () => {
		render(Page);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: /new note/i })).toBeInTheDocument();
		});
	});

	it('creates a new note on button click', async () => {
		vi.mocked(api.notes.create).mockResolvedValueOnce(
			mockNote({ id: 2, title: 'Note - 2024-01-01 00:00:00' })
		);
		vi.mocked(api.notes.list).mockResolvedValue([mockNote()]);
		render(Page);

		await waitFor(() => screen.getByRole('button', { name: /new note/i }));
		await fireEvent.click(screen.getByRole('button', { name: /new note/i }));

		await waitFor(() => {
			expect(api.notes.create).toHaveBeenCalled();
		});
	});

	it('shows starred indicator for starred notes', async () => {
		vi.mocked(api.notes.list).mockResolvedValue([mockNote({ starred: true })]);
		render(Page);
		await waitFor(() => {
			expect(screen.getByTitle(/starred/i)).toBeInTheDocument();
		});
	});

	it('shows pinned notes before non-pinned (pinned badge visible)', async () => {
		vi.mocked(api.notes.list).mockResolvedValue([
			mockNote({ id: 1, title: 'Pinned Note', pinned: true }),
			mockNote({ id: 2, title: 'Regular Note', pinned: false }),
		]);
		render(Page);
		await waitFor(() => {
			expect(screen.getByTitle(/pinned/i)).toBeInTheDocument();
		});
	});
});
