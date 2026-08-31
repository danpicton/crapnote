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

// A fresh module instance per test: readiness is module-level state (has the
// first session check started / settled?), so tests must not inherit it.
async function freshAuth() {
	vi.resetModules();
	const mod = await import('./auth.svelte');
	return mod.auth;
}

describe('auth readiness', () => {
	it('ready() waits for an in-flight init instead of resolving early', async () => {
		const auth = await freshAuth();
		let resolveMe!: (u: typeof fakeUser) => void;
		vi.mocked(api.auth.me).mockReturnValue(
			new Promise<typeof fakeUser>((resolve) => {
				resolveMe = resolve;
			})
		);

		const initPromise = auth.init();
		let settled = false;
		const readyPromise = auth.ready().then(() => {
			settled = true;
		});

		await new Promise((r) => setTimeout(r, 0));
		expect(settled).toBe(false);
		expect(auth.loading).toBe(true);

		resolveMe(fakeUser);
		await Promise.all([initPromise, readyPromise]);

		expect(settled).toBe(true);
		expect(auth.user).toEqual(fakeUser);
		expect(auth.loading).toBe(false);
		expect(api.auth.me).toHaveBeenCalledTimes(1);
	});

	it('ready() starts the session check when nothing has begun one', async () => {
		// A route guard can run before the root layout's onMount has called
		// init() — children mount first — so ready() must not resolve into a
		// logged-out state just because init() has not been called yet.
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockResolvedValue(fakeUser);

		await auth.ready();

		expect(api.auth.me).toHaveBeenCalledTimes(1);
		expect(auth.user).toEqual(fakeUser);
		expect(auth.loading).toBe(false);
	});

	it('concurrent callers share a single /api/auth/me request', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockResolvedValue(fakeUser);

		await Promise.all([auth.ready(), auth.init(), auth.init()]);

		expect(api.auth.me).toHaveBeenCalledTimes(1);
	});

	it('ready() resolves without a new request once the check has settled', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockResolvedValue(fakeUser);
		await auth.init();
		vi.mocked(api.auth.me).mockClear();

		await auth.ready();

		expect(api.auth.me).not.toHaveBeenCalled();
		expect(auth.user).toEqual(fakeUser);
	});

	it('a fresh login settles readiness without another /api/auth/me', async () => {
		// The notes page awaits ready() before it will touch the offline
		// store. Straight after a login the session is already known, so
		// making that await cost a redundant round-trip would delay the
		// first paint for nothing.
		const auth = await freshAuth();
		vi.mocked(api.auth.login).mockResolvedValue(fakeUser);

		await auth.login('alice', 'pw');
		await auth.ready();

		expect(api.auth.me).not.toHaveBeenCalled();
		expect(auth.user).toEqual(fakeUser);
	});

	it('an explicit init() after settling still re-checks the session', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockResolvedValue(fakeUser);
		await auth.init();
		vi.mocked(api.auth.me).mockClear();
		vi.mocked(api.auth.me).mockResolvedValue({ ...fakeUser, username: 'renamed' });

		await auth.init();

		expect(api.auth.me).toHaveBeenCalledTimes(1);
		expect(auth.user?.username).toBe('renamed');
	});
});
