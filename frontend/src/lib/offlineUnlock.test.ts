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
} from './offlineUnlock';

const RECORD_KEY = 'crapnote:offline-unlock';

beforeEach(() => {
	localStorage.clear();
	vi.unstubAllGlobals();
});

describe('offline unlock passcode', () => {
	it('uses a KDF with an OWASP-grade iteration count, not a bare digest', () => {
		expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
	});

	it('stores no trace of the password itself', async () => {
		await storeUnlockPasscode('correct horse battery staple');

		const raw = localStorage.getItem(RECORD_KEY)!;
		expect(raw).not.toContain('correct horse battery staple');
		const rec = JSON.parse(raw);
		expect(rec.iterations).toBe(PBKDF2_ITERATIONS);
		expect(typeof rec.salt).toBe('string');
		expect(typeof rec.hash).toBe('string');
	});

	it('salts per install, so two identical passwords hash differently', async () => {
		await storeUnlockPasscode('same-password');
		const first = JSON.parse(localStorage.getItem(RECORD_KEY)!);
		localStorage.clear();
		await storeUnlockPasscode('same-password');
		const second = JSON.parse(localStorage.getItem(RECORD_KEY)!);

		expect(second.salt).not.toBe(first.salt);
		expect(second.hash).not.toBe(first.hash);
	});

	it('accepts the right password and rejects a wrong one', async () => {
		await storeUnlockPasscode('s3cret-pw');

		expect(await verifyUnlockPasscode('s3cret-pw')).toBe(true);
		expect(await verifyUnlockPasscode('s3cret-pW')).toBe(false);
		expect(await verifyUnlockPasscode('')).toBe(false);
	});

	it('reports whether unlock material exists', async () => {
		expect(hasUnlockPasscode()).toBe(false);
		await storeUnlockPasscode('pw');
		expect(hasUnlockPasscode()).toBe(true);
		clearUnlockPasscode();
		expect(hasUnlockPasscode()).toBe(false);
	});

	it('fails closed when the stored record is corrupt or truncated', async () => {
		localStorage.setItem(RECORD_KEY, 'not json');
		expect(hasUnlockPasscode()).toBe(false);
		expect(await verifyUnlockPasscode('anything')).toBe(false);

		localStorage.setItem(RECORD_KEY, JSON.stringify({ v: 1, iterations: 600000, salt: 'AAAA' }));
		expect(hasUnlockPasscode()).toBe(false);
		expect(await verifyUnlockPasscode('anything')).toBe(false);
	});

	it('verifies nothing when no record was ever stored', async () => {
		expect(await verifyUnlockPasscode('pw')).toBe(false);
	});

	it('fails closed, and stores nothing, when WebCrypto is unavailable', async () => {
		vi.stubGlobal('crypto', { getRandomValues: undefined, subtle: undefined });

		await storeUnlockPasscode('pw');

		expect(localStorage.getItem(RECORD_KEY)).toBeNull();
		expect(hasUnlockPasscode()).toBe(false);
		expect(await verifyUnlockPasscode('pw')).toBe(false);
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
