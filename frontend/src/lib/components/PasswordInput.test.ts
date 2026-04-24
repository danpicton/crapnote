import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import PasswordInput from './PasswordInput.svelte';

describe('PasswordInput', () => {
	it('renders as a password input by default', () => {
		render(PasswordInput, { id: 'pw', value: 'hunter2' });
		const input = screen.getByLabelText(/show password/i, { selector: 'button' });
		expect(input).toBeInTheDocument();
		const field = document.getElementById('pw') as HTMLInputElement;
		expect(field.type).toBe('password');
		expect(field.value).toBe('hunter2');
	});

	it('toggles to text when the show-password button is clicked', async () => {
		render(PasswordInput, { id: 'pw', value: '' });
		const field = document.getElementById('pw') as HTMLInputElement;
		expect(field.type).toBe('password');

		const toggle = screen.getByRole('button', { name: /show password/i });
		await fireEvent.click(toggle);

		expect(field.type).toBe('text');
		expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();
	});

	it('toggles back to password when clicked again', async () => {
		render(PasswordInput, { id: 'pw', value: '' });
		const field = document.getElementById('pw') as HTMLInputElement;

		await fireEvent.click(screen.getByRole('button', { name: /show password/i }));
		expect(field.type).toBe('text');
		await fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
		expect(field.type).toBe('password');
	});

	it('forwards value changes via bind', async () => {
		let captured = '';
		const { component } = render(PasswordInput, {
			id: 'pw',
			value: '',
			onchange: (v: string) => {
				captured = v;
			},
		});
		void component;
		const field = document.getElementById('pw') as HTMLInputElement;
		await fireEvent.input(field, { target: { value: 'secret' } });
		expect(captured).toBe('secret');
	});

	it('supports autocomplete, placeholder, required, and disabled', () => {
		render(PasswordInput, {
			id: 'pw',
			value: '',
			autocomplete: 'new-password',
			placeholder: 'Password',
			required: true,
			disabled: true,
		});
		const field = document.getElementById('pw') as HTMLInputElement;
		expect(field.getAttribute('autocomplete')).toBe('new-password');
		expect(field.placeholder).toBe('Password');
		expect(field.required).toBe(true);
		expect(field.disabled).toBe(true);
	});
});
