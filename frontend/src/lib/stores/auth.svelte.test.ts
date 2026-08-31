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

vi.mock('$lib/offlineUnlock', () => ({
	storeUnlockPasscode: vi.fn().mockResolvedValue(undefined),
	hasUnlockPasscode: vi.fn().mockReturnValue(true),
	verifyUnlockPasscode: vi.fn().mockResolvedValue(true),
	clearUnlockPasscode: vi.fn(),
	recordFailedUnlock: vi.fn(),
	resetUnlockAttempts: vi.fn(),
	unlockLockoutRemainingMs: vi.fn().mockReturnValue(0),
	markIdentityProved: vi.fn().mockResolvedValue(undefined),
	identityProvedInThisSession: vi.fn().mockResolvedValue(false),
	clearIdentityProof: vi.fn(),
}));

import { api, ApiError, OfflineError } from '$lib/api';
import {
	storeUnlockPasscode,
	hasUnlockPasscode,
	verifyUnlockPasscode,
	recordFailedUnlock,
	resetUnlockAttempts,
	unlockLockoutRemainingMs,
	markIdentityProved,
	identityProvedInThisSession,
} from '$lib/offlineUnlock';
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
	vi.mocked(hasUnlockPasscode).mockReturnValue(true);
	vi.mocked(verifyUnlockPasscode).mockResolvedValue(true);
	vi.mocked(unlockLockoutRemainingMs).mockReturnValue(0);
	vi.mocked(identityProvedInThisSession).mockResolvedValue(false);
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


/**
 * Local unlock (issue #61). The offline store and the session-user marker
 * live in the same browser profile and survive a browser close together, so
 * matching them proves nothing about who is at the keyboard. Without a live
 * server-confirmed session, the password is the only thing that separates the
 * owner from the next person to open the app.
 */
describe('offline unlock gate', () => {
	it('never locks a live, server-confirmed session', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockResolvedValue(fakeUser);

		await auth.init();

		expect(auth.locked).toBe(false);
		expect(auth.user).toEqual(fakeUser);
	});

	it('locks an offline restore, holding the identity but not trusting it yet', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);

		await auth.init();

		expect(auth.locked).toBe(true);
		expect(auth.user).toEqual(fakeUser);
	});

	it('fails closed offline when this browser has no unlock material', async () => {
		// An install from before unlock shipped, or a browser without
		// WebCrypto: there is no way to prove ownership, so the identity must
		// not be restored at all — never "no passcode, therefore let them in".
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		vi.mocked(hasUnlockPasscode).mockReturnValue(false);

		await auth.init();

		expect(auth.user).toBeNull();
		expect(auth.locked).toBe(false);
		expect(ensureOfflineOwner).not.toHaveBeenCalled();
	});

	it('stays logged out, and unlocked, offline when nobody was ever persisted', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());

		await auth.init();

		expect(auth.user).toBeNull();
		expect(auth.locked).toBe(false);
	});

	it('binds the unlock material to the account that logged in', async () => {
		// A record left behind by one account must not open another's store.
		const auth = await freshAuth();
		vi.mocked(api.auth.login).mockResolvedValue(fakeUser);
		await auth.login('alice', 'pw');

		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		await auth.init();
		await auth.unlock('pw');

		expect(verifyUnlockPasscode).toHaveBeenCalledWith(3, 'pw');
		expect(hasUnlockPasscode).toHaveBeenCalledWith(3);
	});

	it('records unlock material at login, so the next offline start can be unlocked', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.login).mockResolvedValue(fakeUser);

		await auth.login('alice', 'pw');

		expect(storeUnlockPasscode).toHaveBeenCalledWith(3, 'pw');
		expect(auth.locked).toBe(false);
	});

	it('unlocks on the right password and clears the failure count', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		await auth.init();

		await expect(auth.unlock('pw')).resolves.toBe(true);

		expect(auth.locked).toBe(false);
		expect(resetUnlockAttempts).toHaveBeenCalled();
	});

	it('stays locked on a wrong password and counts the failure', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		await auth.init();
		vi.mocked(verifyUnlockPasscode).mockResolvedValue(false);

		await expect(auth.unlock('wrong')).resolves.toBe(false);

		expect(auth.locked).toBe(true);
		expect(recordFailedUnlock).toHaveBeenCalledTimes(1);
	});

	it('refuses to even derive a key while a cooldown is running', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		await auth.init();
		vi.mocked(unlockLockoutRemainingMs).mockReturnValue(30_000);

		await expect(auth.unlock('pw')).resolves.toBe(false);

		expect(verifyUnlockPasscode).not.toHaveBeenCalled();
		expect(auth.locked).toBe(true);
		expect(auth.unlockLockoutMs).toBe(30_000);
	});

	it('a locked session is not a readable one', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		await auth.init();

		expect(auth.canReadCache).toBe(false);
		await auth.unlock('pw');
		expect(auth.canReadCache).toBe(true);
	});
});


/**
 * Re-prompting policy. The lock exists because the identity marker and the
 * offline store survive a browser close together; sessionStorage does not, so
 * "was this identity proved in THIS browsing session?" separates a reload by
 * the same person from a fresh start by the next one.
 */
describe('offline unlock: same-session continuity', () => {
	it('does not re-prompt on an offline reload within the same browsing session', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		vi.mocked(identityProvedInThisSession).mockResolvedValue(true);

		await auth.init();

		expect(auth.locked).toBe(false);
		expect(auth.user).toEqual(fakeUser);
		expect(auth.canReadCache).toBe(true);
	});

	it('cannot hold a proof at all without unlock material, so it fails closed', async () => {
		// The proof is authenticated with the unlock record, so a browser
		// without one can hold no proof — `identityProvedInThisSession` is
		// false there by construction. That closes the pre-upgrade window
		// (a cookie-restored session that never saw a password) to /login
		// rather than leaving an unauthenticated proof anyone could forge.
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		vi.mocked(identityProvedInThisSession).mockResolvedValue(false);
		vi.mocked(hasUnlockPasscode).mockReturnValue(false);

		await auth.init();

		expect(auth.user).toBeNull();
		expect(auth.locked).toBe(false);
	});

	it('locks a fresh browsing session even though the profile is unchanged', async () => {
		// The browser was closed and reopened: same localStorage, same store,
		// no sessionStorage. This is the #61 attack.
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		vi.mocked(identityProvedInThisSession).mockResolvedValue(false);

		await auth.init();

		expect(auth.locked).toBe(true);
		expect(auth.canReadCache).toBe(false);
	});

	it('takes a proof whenever identity is actually established', async () => {
		const auth = await freshAuth();

		vi.mocked(api.auth.me).mockResolvedValue(fakeUser);
		await auth.init();
		expect(markIdentityProved).toHaveBeenCalledWith(3);

		vi.mocked(markIdentityProved).mockClear();
		vi.mocked(api.auth.login).mockResolvedValue(fakeUser);
		await auth.login('alice', 'pw');
		expect(markIdentityProved).toHaveBeenCalledWith(3);
	});

	it('stores the unlock record before taking a proof keyed by it', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.login).mockResolvedValue(fakeUser);

		await auth.login('alice', 'pw');

		const stored = vi.mocked(storeUnlockPasscode).mock.invocationCallOrder[0];
		const proved = vi.mocked(markIdentityProved).mock.invocationCallOrder[0];
		expect(stored).toBeLessThan(proved);
	});

	it('takes a proof on a successful unlock, so the next reload is quiet', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		await auth.init();
		vi.mocked(markIdentityProved).mockClear();

		await auth.unlock('pw');

		expect(markIdentityProved).toHaveBeenCalledWith(3);
	});

	it('takes no proof from a failed unlock', async () => {
		const auth = await freshAuth();
		vi.mocked(api.auth.me).mockRejectedValue(new OfflineError());
		vi.mocked(readSessionUser).mockReturnValueOnce(fakeUser);
		await auth.init();
		vi.mocked(markIdentityProved).mockClear();
		vi.mocked(verifyUnlockPasscode).mockResolvedValue(false);

		await auth.unlock('wrong');

		expect(markIdentityProved).not.toHaveBeenCalled();
	});
});
