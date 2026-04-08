import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TrashPage from './+page.svelte';

vi.mock('$lib/api', () => ({
	api: {
		trash: {
			list: vi.fn(),
			restore: vi.fn(),
			deleteOne: vi.fn(),
			empty: vi.fn(),
		},
	},
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { api } from '$lib/api';

const mockEntry = (overrides = {}) => ({
	note_id: 1,
	title: 'Deleted Note',
	deleted_at: '2024-01-01T00:00:00Z',
	permanent_delete_at: '2024-01-08T00:00:00Z',
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.trash.list).mockResolvedValue([mockEntry()]);
});

describe('Trash page', () => {
	it('renders heading', async () => {
		render(TrashPage);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: /trash/i })).toBeInTheDocument();
		});
	});

	it('shows trashed note titles', async () => {
		render(TrashPage);
		await waitFor(() => {
			expect(screen.getByText('Deleted Note')).toBeInTheDocument();
		});
	});

	it('shows empty trash button', async () => {
		render(TrashPage);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: /empty trash/i })).toBeInTheDocument();
		});
	});

	it('calls restore on restore button click', async () => {
		vi.mocked(api.trash.restore).mockResolvedValueOnce(undefined);
		// list already mocked in beforeEach to return [mockEntry()]
		render(TrashPage);

		await waitFor(() => screen.getByText('Deleted Note'));
		await fireEvent.click(screen.getByRole('button', { name: /restore/i }));

		await waitFor(() => {
			expect(api.trash.restore).toHaveBeenCalledWith(1);
		});
	});

	it('calls empty on empty trash button', async () => {
		vi.stubGlobal('confirm', () => true);
		vi.mocked(api.trash.empty).mockResolvedValueOnce(undefined);
		vi.mocked(api.trash.list).mockResolvedValue([]);
		render(TrashPage);

		await waitFor(() => screen.getByRole('button', { name: /empty trash/i }));
		await fireEvent.click(screen.getByRole('button', { name: /empty trash/i }));

		await waitFor(() => {
			expect(api.trash.empty).toHaveBeenCalled();
		});
		vi.unstubAllGlobals();
	});

	it('shows empty state when trash is empty', async () => {
		vi.mocked(api.trash.list).mockResolvedValue([]);
		render(TrashPage);

		await waitFor(() => {
			expect(screen.getByText(/trash is empty/i)).toBeInTheDocument();
		});
	});
});
