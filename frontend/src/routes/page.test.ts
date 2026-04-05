import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import Page from './+page.svelte';

describe('Home page', () => {
	it('renders the app name', () => {
		render(Page);
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('CrapNote');
	});
});
