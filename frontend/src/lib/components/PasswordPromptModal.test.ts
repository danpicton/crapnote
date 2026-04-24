import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PasswordPromptModal from './PasswordPromptModal.svelte';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('PasswordPromptModal', () => {
	it('does not render when closed', () => {
		render(PasswordPromptModal, { open: false, title: 'Set password', onsubmit: vi.fn(), oncancel: vi.fn() });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('renders a dialog with two password fields and the given title', () => {
		render(PasswordPromptModal, { open: true, title: 'Set password for alice', onsubmit: vi.fn(), oncancel: vi.fn() });
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText(/set password for alice/i)).toBeInTheDocument();
		expect(screen.getByLabelText('New password')).toBeInTheDocument();
		expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
	});

	it('submits the password when both fields match and are long enough', async () => {
		const onsubmit = vi.fn();
		render(PasswordPromptModal, { open: true, title: 'Set password', onsubmit, oncancel: vi.fn() });

		await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'correct-horse-battery' } });
		await fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'correct-horse-battery' } });
		await fireEvent.click(screen.getByRole('button', { name: /save/i }));

		expect(onsubmit).toHaveBeenCalledWith('correct-horse-battery');
	});

	it('shows an error and does not submit when passwords differ', async () => {
		const onsubmit = vi.fn();
		render(PasswordPromptModal, { open: true, title: 'Set password', onsubmit, oncancel: vi.fn() });

		await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'correct-horse-battery' } });
		await fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'different-password-xyz' } });
		await fireEvent.click(screen.getByRole('button', { name: /save/i }));

		expect(screen.getByRole('alert').textContent).toMatch(/match/i);
		expect(onsubmit).not.toHaveBeenCalled();
	});

	it('shows an error when password is shorter than 12 characters', async () => {
		const onsubmit = vi.fn();
		render(PasswordPromptModal, { open: true, title: 'Set password', onsubmit, oncancel: vi.fn() });

		await fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'short' } });
		await fireEvent.input(screen.getByLabelText('Confirm password'), { target: { value: 'short' } });
		await fireEvent.click(screen.getByRole('button', { name: /save/i }));

		expect(screen.getByRole('alert').textContent).toMatch(/12 characters/i);
		expect(onsubmit).not.toHaveBeenCalled();
	});

	it('fires oncancel when the Cancel button is clicked', async () => {
		const oncancel = vi.fn();
		render(PasswordPromptModal, { open: true, title: 'Set password', onsubmit: vi.fn(), oncancel });
		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
		expect(oncancel).toHaveBeenCalled();
	});
});
