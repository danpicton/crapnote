// Minimal stub for SvelteKit's $app/state module used in tests.
// Individual tests override via vi.mock('$app/state', ...) as needed.
export const page = {
	url: new URL('http://localhost/'),
	params: {} as Record<string, string>,
	route: { id: null as string | null },
	status: 200,
	error: null as unknown,
	data: {} as Record<string, unknown>,
	form: null as unknown,
	state: {} as Record<string, unknown>,
};

export const navigating = null;
export const updated = { current: false, check: async () => false };
