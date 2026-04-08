import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ArchivePage from './+page.svelte';

vi.mock('$lib/api', () => ({
	api: {
		notes: {
			listArchived: vi.fn(),
			unarchive: vi.fn(),
			delete: vi.fn(),
		},
	},
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { api } from '$lib/api';

const mockNote = (overrides = {}) => ({
	id: 1, title: 'Archived Note', body: '', starred: false, pinned: false, archived: true,
	created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.notes.listArchived).mockResolvedValue([mockNote()]);
	vi.stubGlobal('confirm', () => true);
});

describe('Archive page', () => {
	it('renders heading', async () => {
		render(ArchivePage);
		await waitFor(() => expect(screen.getByRole('heading', { name: /archive/i })).toBeInTheDocument());
	});

	it('shows archived note titles', async () => {
		render(ArchivePage);
		await waitFor(() => expect(screen.getByText('Archived Note')).toBeInTheDocument());
	});

	it('shows empty state when archive is empty', async () => {
		vi.mocked(api.notes.listArchived).mockResolvedValue([]);
		render(ArchivePage);
		await waitFor(() => expect(screen.getByText(/archive is empty/i)).toBeInTheDocument());
	});

	it('calls unarchive on restore click', async () => {
		vi.mocked(api.notes.unarchive).mockResolvedValueOnce(undefined);
		render(ArchivePage);
		await waitFor(() => screen.getByText('Archived Note'));
		await fireEvent.click(screen.getByRole('button', { name: /restore from archive/i }));
		await waitFor(() => expect(api.notes.unarchive).toHaveBeenCalledWith(1));
	});

	it('calls delete on delete click', async () => {
		vi.mocked(api.notes.delete).mockResolvedValueOnce(undefined);
		render(ArchivePage);
		await waitFor(() => screen.getByText('Archived Note'));
		await fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));
		await waitFor(() => expect(api.notes.delete).toHaveBeenCalledWith(1));
	});
});
