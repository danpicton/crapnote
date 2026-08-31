import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	PBKDF2_ITERATIONS,
	storeUnlockPasscode,
	hasUnlockPasscode,
	verifyUnlockPasscode,
	clearUnlockPasscode,
	recordFailedUnlock,
	resetUnlockAttempts,
	unlockLockoutRemainingMs,
	UNLOCK_FREE_ATTEMPTS,
	UNLOCK_PROOF_MAX_AGE_MS,
	markIdentityProved,
	identityProvedInThisSession,
	clearIdentityProof,
} from './offlineUnlock';

const RECORD_KEY = 'crapnote:offline-unlock';

beforeEach(() => {
	// Unstub FIRST: a test that replaces `sessionStorage` with a throwing
	// stub would otherwise leave the next test unable to clear it.
	vi.unstubAllGlobals();
	localStorage.clear();
	sessionStorage.clear();
});

describe('offline unlock passcode', () => {
	it('uses a KDF with an OWASP-grade iteration count, not a bare digest', () => {
		expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
	});

	it('stores no trace of the password itself', async () => {
		await storeUnlockPasscode(7, 'correct horse battery staple');

		const raw = localStorage.getItem(RECORD_KEY)!;
		expect(raw).not.toContain('correct horse battery staple');
		const rec = JSON.parse(raw);
		expect(rec.iterations).toBe(PBKDF2_ITERATIONS);
		expect(typeof rec.salt).toBe('string');
		expect(typeof rec.hash).toBe('string');
	});

	it('salts per install, so two identical passwords hash differently', async () => {
		await storeUnlockPasscode(7, 'same-password');
		const first = JSON.parse(localStorage.getItem(RECORD_KEY)!);
		localStorage.clear();
		await storeUnlockPasscode(7, 'same-password');
		const second = JSON.parse(localStorage.getItem(RECORD_KEY)!);

		expect(second.salt).not.toBe(first.salt);
		expect(second.hash).not.toBe(first.hash);
	});

	it('accepts the right password and rejects a wrong one', async () => {
		await storeUnlockPasscode(7, 's3cret-pw');

		expect(await verifyUnlockPasscode(7, 's3cret-pw')).toBe(true);
		expect(await verifyUnlockPasscode(7, 's3cret-pW')).toBe(false);
		expect(await verifyUnlockPasscode(7, '')).toBe(false);
	});

	it('reports whether unlock material exists', async () => {
		expect(hasUnlockPasscode(7)).toBe(false);
		await storeUnlockPasscode(7, 'pw');
		expect(hasUnlockPasscode(7)).toBe(true);
		clearUnlockPasscode();
		expect(hasUnlockPasscode(7)).toBe(false);
	});

	it('fails closed when the stored record is corrupt or truncated', async () => {
		localStorage.setItem(RECORD_KEY, 'not json');
		expect(hasUnlockPasscode(7)).toBe(false);
		expect(await verifyUnlockPasscode(7, 'anything')).toBe(false);

		localStorage.setItem(RECORD_KEY, JSON.stringify({ v: 2, userId: 7, iterations: 600000, salt: 'AAAA' }));
		expect(hasUnlockPasscode(7)).toBe(false);
		expect(await verifyUnlockPasscode(7, 'anything')).toBe(false);
	});

	it('rejects, rather than throws, when the stored salt is not decodable', async () => {
		// A record that parses but cannot be decoded used to leave the owner
		// with a lock that could never open and no message — the promise
		// rejected out of a handler that had no catch.
		localStorage.setItem(
			RECORD_KEY,
			JSON.stringify({ v: 2, userId: 7, iterations: 1000, salt: '!!!not base64!!!', hash: 'AAAA' })
		);

		expect(hasUnlockPasscode(7)).toBe(false);
		await expect(verifyUnlockPasscode(7, 'anything')).resolves.toBe(false);
	});

	it('rejects an unreadable hash the same way', async () => {
		await storeUnlockPasscode(7, 'pw');
		const rec = JSON.parse(localStorage.getItem(RECORD_KEY)!);
		localStorage.setItem(RECORD_KEY, JSON.stringify({ ...rec, hash: '@@@' }));

		expect(hasUnlockPasscode(7)).toBe(false);
		await expect(verifyUnlockPasscode(7, 'pw')).resolves.toBe(false);
	});

	it('binds the record to one account', async () => {
		// Otherwise a record left by any account unlocks any store: the id is
		// both recorded and mixed into the derived key.
		await storeUnlockPasscode(7, 'pw');

		expect(hasUnlockPasscode(8)).toBe(false);
		expect(await verifyUnlockPasscode(8, 'pw')).toBe(false);
		expect(await verifyUnlockPasscode(7, 'pw')).toBe(true);
	});

	it('refuses a record written for an older, unbound format', async () => {
		await storeUnlockPasscode(7, 'pw');
		const rec = JSON.parse(localStorage.getItem(RECORD_KEY)!);
		localStorage.setItem(RECORD_KEY, JSON.stringify({ ...rec, v: 1, userId: undefined }));

		expect(hasUnlockPasscode(7)).toBe(false);
		expect(await verifyUnlockPasscode(7, 'pw')).toBe(false);
	});

	it('verifies nothing when no record was ever stored', async () => {
		expect(await verifyUnlockPasscode(7, 'pw')).toBe(false);
	});

	it('fails closed, and stores nothing, when WebCrypto is unavailable', async () => {
		vi.stubGlobal('crypto', { getRandomValues: undefined, subtle: undefined });

		await storeUnlockPasscode(7, 'pw');
		expect(hasUnlockPasscode(7)).toBe(false);

		expect(localStorage.getItem(RECORD_KEY)).toBeNull();
		expect(hasUnlockPasscode(7)).toBe(false);
		expect(await verifyUnlockPasscode(7, 'pw')).toBe(false);
	});
});

describe('offline unlock throttle', () => {
	it('allows a few mistakes before any lockout', () => {
		for (let i = 0; i < UNLOCK_FREE_ATTEMPTS; i++) recordFailedUnlock(1_000);
		expect(unlockLockoutRemainingMs(1_000)).toBe(0);
	});

	it('locks out, with a backoff that grows, once the free attempts are gone', () => {
		for (let i = 0; i < UNLOCK_FREE_ATTEMPTS; i++) recordFailedUnlock(1_000);

		recordFailedUnlock(1_000);
		const first = unlockLockoutRemainingMs(1_000);
		expect(first).toBeGreaterThan(0);

		recordFailedUnlock(1_000 + first);
		const second = unlockLockoutRemainingMs(1_000 + first);
		expect(second).toBeGreaterThan(first);
	});

	it('caps the backoff so the owner is never locked out for ever', () => {
		for (let i = 0; i < 60; i++) recordFailedUnlock(0);
		expect(unlockLockoutRemainingMs(0)).toBeLessThanOrEqual(15 * 60 * 1000);
	});

	it('survives a reload, so reloading the page is not a way round the throttle', () => {
		for (let i = 0; i < UNLOCK_FREE_ATTEMPTS + 1; i++) recordFailedUnlock(1_000);
		const remaining = unlockLockoutRemainingMs(1_000);

		// A reload only drops in-memory state; localStorage is what persists.
		expect(unlockLockoutRemainingMs(1_000)).toBe(remaining);
		expect(remaining).toBeGreaterThan(0);
	});

	it('expires once the cooldown has passed, and resets on success', () => {
		for (let i = 0; i < UNLOCK_FREE_ATTEMPTS + 1; i++) recordFailedUnlock(1_000);
		const remaining = unlockLockoutRemainingMs(1_000);
		expect(unlockLockoutRemainingMs(1_000 + remaining)).toBe(0);

		resetUnlockAttempts();
		for (let i = 0; i < UNLOCK_FREE_ATTEMPTS; i++) recordFailedUnlock(1_000);
		expect(unlockLockoutRemainingMs(1_000)).toBe(0);
	});

	it('never destroys the offline store as a lockout response', async () => {
		// Unsynced offline edits live only in that store; wiping it on a
		// mistyped password would silently lose the owner's work.
		const mod = await import('./offlineUnlock');
		expect(Object.keys(mod).some((k) => /wipe|clearLocalData|deleteOfflineDB/i.test(k))).toBe(false);
	});
});


/**
 * Continuity of the browsing session. sessionStorage survives a reload and
 * same-tab navigation but is gone once the tab or PWA window is closed —
 * which is exactly the line issue #61 draws ("closes the browser without
 * logging out"). So it can distinguish "the same person is still here" from
 * "someone opened this app afresh" without a wall-clock guess.
 */
describe('identity proof for the current browsing session', () => {
	// Every proof is authenticated with the account's unlock material, so a
	// record has to exist before one can be taken.
	beforeEach(async () => {
		await storeUnlockPasscode(7, 'pw');
	});

	it('remembers a proof taken in this browsing session', async () => {
		await markIdentityProved(7, 1_000);
		expect(await identityProvedInThisSession(7, 1_000)).toBe(true);
	});

	it('is not a proof for a different account', async () => {
		await markIdentityProved(7, 1_000);
		expect(await identityProvedInThisSession(8, 1_000)).toBe(false);
	});

	it('has none when nothing was ever proved', async () => {
		expect(await identityProvedInThisSession(7, 1_000)).toBe(false);
	});

	it('expires, so a browser left open unattended re-locks', async () => {
		await markIdentityProved(7, 1_000);
		expect(await identityProvedInThisSession(7, 1_000 + UNLOCK_PROOF_MAX_AGE_MS - 1)).toBe(true);
		expect(await identityProvedInThisSession(7, 1_000 + UNLOCK_PROOF_MAX_AGE_MS + 1)).toBe(false);
	});

	it('refuses a future-dated proof, so the cap cannot be dodged by the clock', async () => {
		// `now` comes from the page, so a proof stamped in the future would
		// otherwise stay valid indefinitely.
		await markIdentityProved(7, 5_000_000);
		expect(await identityProvedInThisSession(7, 1_000)).toBe(false);
	});

	it('does not outlive the browsing session it was taken in', async () => {
		await markIdentityProved(7, 1_000);
		// Closing the tab/window is what clears sessionStorage; nothing else
		// in the profile does. localStorage explicitly must NOT carry it.
		expect(localStorage.getItem('crapnote:offline-unlock-session')).toBeNull();
		sessionStorage.clear();
		expect(await identityProvedInThisSession(7, 1_000)).toBe(false);
	});

	it('is dropped explicitly at logout', async () => {
		await markIdentityProved(7, 1_000);
		clearIdentityProof();
		expect(await identityProvedInThisSession(7, 1_000)).toBe(false);
	});

	it('fails closed on a corrupt record', async () => {
		sessionStorage.setItem('crapnote:offline-unlock-session', 'not json');
		expect(await identityProvedInThisSession(7, 1_000)).toBe(false);
	});

	it('fails closed when sessionStorage is unavailable', async () => {
		vi.stubGlobal('sessionStorage', {
			getItem: () => { throw new Error('blocked'); },
			setItem: () => { throw new Error('blocked'); },
			removeItem: () => { throw new Error('blocked'); },
		});
		await expect(markIdentityProved(7, 1_000)).resolves.toBeUndefined();
		expect(await identityProvedInThisSession(7, 1_000)).toBe(false);
	});

	it('cannot be forged by writing plausible JSON', async () => {
		// The whole point: without this, one line of JSON opened the cache
		// with no password and no crypto, making the proof a far weaker
		// artefact than the KDF record it stands in for.
		sessionStorage.setItem(
			'crapnote:offline-unlock-session',
			JSON.stringify({ userId: 7, at: 1_000 })
		);
		expect(await identityProvedInThisSession(7, 1_000)).toBe(false);

		sessionStorage.setItem(
			'crapnote:offline-unlock-session',
			JSON.stringify({ userId: 7, at: 1_000, mac: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' })
		);
		expect(await identityProvedInThisSession(7, 1_000)).toBe(false);
	});

	it('cannot be moved to another timestamp or account', async () => {
		await markIdentityProved(7, 1_000);
		const proof = JSON.parse(sessionStorage.getItem('crapnote:offline-unlock-session')!);

		sessionStorage.setItem(
			'crapnote:offline-unlock-session',
			JSON.stringify({ ...proof, at: 4_000 })
		);
		expect(await identityProvedInThisSession(7, 4_000)).toBe(false);

		sessionStorage.setItem(
			'crapnote:offline-unlock-session',
			JSON.stringify({ ...proof, userId: 8 })
		);
		expect(await identityProvedInThisSession(8, 1_000)).toBe(false);
	});

	it('cannot be transplanted onto a browser with different unlock material', async () => {
		await markIdentityProved(7, 1_000);
		const proof = sessionStorage.getItem('crapnote:offline-unlock-session')!;

		// Same account, same password, different install (different salt).
		localStorage.removeItem('crapnote:offline-unlock');
		await storeUnlockPasscode(7, 'pw');
		sessionStorage.setItem('crapnote:offline-unlock-session', proof);

		expect(await identityProvedInThisSession(7, 1_000)).toBe(false);
	});

	it('takes no proof at all when there is no unlock material to key it with', async () => {
		// Fail closed rather than fall back to an unauthenticated proof: an
		// optional MAC is no MAC, because the forger simply deletes the
		// record and takes the weaker path.
		localStorage.removeItem('crapnote:offline-unlock');

		await markIdentityProved(7, 1_000);

		expect(sessionStorage.getItem('crapnote:offline-unlock-session')).toBeNull();
		expect(await identityProvedInThisSession(7, 1_000)).toBe(false);
	});
});
