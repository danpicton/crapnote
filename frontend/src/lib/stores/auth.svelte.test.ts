import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api', () => ({
	api: {
		auth: {
			me: vi.fn(),
			login: vi.fn(),
			logout: vi.fn(),
		},
	},
}));

vi.mock('$lib/localData', () => ({
	clearLocalData: vi.fn().mockResolvedValue(undefined),
	ensureOfflineOwner: vi.fn().mockResolvedValue(undefined),
}));

import { api } from '$lib/api';
import { clearLocalData, ensureOfflineOwner } from '$lib/localData';
import { auth } from './auth.svelte';

const fakeUser = { id: 3, username: 'alice', is_admin: false, created_at: '' };

beforeEach(() => {
	vi.clearAllMocks();
	auth.setUser(null);
});

describe('auth.logout', () => {
	it('clears the local authenticated footprint (caches + offline store)', async () => {
		auth.setUser(fakeUser);
		vi.mocked(api.auth.logout).mockResolvedValue(undefined);

		await auth.logout();

		expect(clearLocalData).toHaveBeenCalledTimes(1);
		expect(auth.user).toBeNull();
	});

	it('still clears local data when the server logout call fails', async () => {
		auth.setUser(fakeUser);
		vi.mocked(api.auth.logout).mockRejectedValue(new Error('network down'));

		await expect(auth.logout()).rejects.toThrow('network down');

		expect(clearLocalData).toHaveBeenCalledTimes(1);
		expect(auth.user).toBeNull();
	});
});

describe('offline store ownership stamping', () => {
	it('login binds the offline store to the logged-in user', async () => {
		vi.mocked(api.auth.login).mockResolvedValue(fakeUser);

		await auth.login('alice', 'pw');

		expect(ensureOfflineOwner).toHaveBeenCalledWith(3);
	});

	it('init binds the offline store to the restored session user', async () => {
		vi.mocked(api.auth.me).mockResolvedValue(fakeUser);

		await auth.init();

		expect(ensureOfflineOwner).toHaveBeenCalledWith(3);
	});

	it('init does not touch ownership when there is no session', async () => {
		vi.mocked(api.auth.me).mockRejectedValue(new Error('401'));

		await auth.init();

		expect(ensureOfflineOwner).not.toHaveBeenCalled();
	});
});
