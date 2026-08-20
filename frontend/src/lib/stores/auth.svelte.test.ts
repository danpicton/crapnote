import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api', () => {
	class ApiError extends Error {
		constructor(public readonly status: number, message: string) {
			super(message);
			this.name = 'ApiError';
		}
	}
	class OfflineError extends ApiError {
		constructor(message = 'offline') {
			super(503, message);
			this.name = 'OfflineError';
		}
	}
	return {
		ApiError,
		OfflineError,
		api: {
			auth: {
				me: vi.fn(),
				login: vi.fn(),
				logout: vi.fn(),
			},
		},
	};
});

vi.mock('$lib/localData', () => ({
	clearLocalData: vi.fn().mockResolvedValue(undefined),
	ensureOfflineOwner: vi.fn().mockResolvedValue(undefined),
	persistSessionUser: vi.fn(),
	readSessionUser: vi.fn().mockReturnValue(null),
	clearSessionUser: vi.fn(),
}));

import { api, ApiError, OfflineError } from '$lib/api';
import {
	clearLocalData,
	ensureOfflineOwner,
	persistSessionUser,
	readSessionUser,
	clearSessionUser,
} from '$lib/localData';
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

describe('offline session restore', () => {
	it('persists the user on a successful session check', async () => {
		vi.mocked(api.auth.me).mockResolvedValue(fakeUser);

		await auth.init();

		expect(persistSessionUser).toHaveBeenCalledWith(fakeUser);
	});

	it('persists the user on login', async () => {
		vi.mocked(api.auth.login).mockResolvedValue(fakeUser);

		await auth.login('alice', 'pw');

		expect(persistSessionUser).toHaveBeenCalledWith(fakeUser);
	});

	it('restores the persisted user when the session check fails offline', async () => {
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);

		await auth.init();

		expect(auth.user).toEqual(fakeUser);
		expect(ensureOfflineOwner).toHaveBeenCalledWith(3);
		expect(clearSessionUser).not.toHaveBeenCalled();
	});

	it('stays logged out offline when no user was ever persisted', async () => {
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());

		await auth.init();

		expect(auth.user).toBeNull();
		expect(ensureOfflineOwner).not.toHaveBeenCalled();
	});

	it('forgets the persisted user when the server rejects the session with 401', async () => {
		vi.mocked(api.auth.me).mockRejectedValue(new ApiError(401, 'unauthorized'));

		await auth.init();

		expect(auth.user).toBeNull();
		expect(clearSessionUser).toHaveBeenCalledTimes(1);
	});

	it('keeps the persisted user through a transient server error (5xx)', async () => {
		vi.mocked(api.auth.me).mockRejectedValue(new ApiError(502, 'bad gateway'));

		await auth.init();

		expect(auth.user).toBeNull();
		expect(clearSessionUser).not.toHaveBeenCalled();
	});
});
