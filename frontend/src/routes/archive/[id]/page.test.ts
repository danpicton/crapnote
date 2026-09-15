import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ params: { id: '7' } }) };
});
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/components/Editor.svelte', () => ({
	default: (anchor: unknown, props: unknown) => { void anchor; void props; },
}));
vi.mock('$lib/api', () => ({
	api: { notes: { listArchived: vi.fn(), unarchive: vi.fn(), delete: vi.fn() } },
}));

import { api } from '$lib/api';

const note = (locked: boolean) => ({
	id: 7, title: 'Archived note', body: '', starred: false, pinned: false,
	archived: true, locked, created_at: '', updated_at: '',
});

beforeEach(() => vi.clearAllMocks());

describe('archived note view', () => {
	it('hides delete while locked but leaves restore available', async () => {
		vi.mocked(api.notes.listArchived).mockResolvedValue([note(true)]);
		render(Page);
		await waitFor(() => screen.getByText('Archived note'));

		expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /delete permanently/i })).not.toBeInTheDocument();
	});

	it('shows delete when unlocked', async () => {
		vi.mocked(api.notes.listArchived).mockResolvedValue([note(false)]);
		render(Page);
		await waitFor(() => screen.getByText('Archived note'));

		expect(screen.getByRole('button', { name: /delete permanently/i })).toBeInTheDocument();
	});
});
