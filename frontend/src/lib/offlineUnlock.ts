/**
 * Local unlock for the offline note cache.
 *
 * The offline store and the `crapnote:session-user` marker live in the same
 * browser profile and survive a browser close together, so "the store's owner
 * matches the remembered user" proves nothing about who is sitting at the
 * machine: whoever opens the app next satisfies it. When there is no live,
 * server-confirmed session, the only thing that can distinguish the owner
 * from the next person is something only the owner knows — so we verify the
 * account password locally before any cached row is read.
 *
 * The password itself is never stored. At login we derive a key from it with
 * PBKDF2-HMAC-SHA-256 over a random per-install salt and keep only the salt,
 * the parameters and the derived bytes. Unlocking re-derives and compares.
 *
 * This is a lock, not encryption: the cached rows are still plaintext in
 * IndexedDB, so someone with DevTools reads them regardless (out of scope per
 * #56/#61). What the KDF cost buys is that the stored record is not a
 * practical route back to the password — which matters because that password
 * also opens the account on the server.
 */

/**
 * OWASP's current recommendation for PBKDF2-HMAC-SHA-256. Costs roughly
 * 100-300ms of native WebCrypto per derivation, which is paid once per login
 * and once per unlock attempt — and by anyone trying to guess offline.
 */
export const PBKDF2_ITERATIONS = 600_000;

/** Mistyped passwords before any cooldown starts. */
export const UNLOCK_FREE_ATTEMPTS = 5;
/** First cooldown, doubling with each further failure. */
const UNLOCK_BACKOFF_BASE_MS = 30_000;
/** Ceiling on the cooldown: the legitimate owner must never be locked out
 * permanently by someone else hammering their unlock screen. */
const UNLOCK_BACKOFF_MAX_MS = 15 * 60 * 1000;

const RECORD_KEY = 'crapnote:offline-unlock';
const ATTEMPTS_KEY = 'crapnote:offline-unlock-attempts';

const SALT_BYTES = 16;
const HASH_BYTES = 32;

interface UnlockRecord {
	v: 1;
	iterations: number;
	salt: string;
	hash: string;
}

interface AttemptRecord {
	failures: number;
	lockedUntil: number;
}

function toBase64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

function fromBase64(value: string): Uint8Array {
	const bin = atob(value);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Reads the stored record, or null if absent, unparseable, or incomplete. */
function readRecord(): UnlockRecord | null {
	try {
		const raw = localStorage.getItem(RECORD_KEY);
		if (!raw) return null;
		const rec = JSON.parse(raw) as UnlockRecord;
		if (rec?.v !== 1) return null;
		if (typeof rec.iterations !== 'number' || rec.iterations < 1) return null;
		if (typeof rec.salt !== 'string' || typeof rec.hash !== 'string') return null;
		if (!rec.salt || !rec.hash) return null;
		return rec;
	} catch {
		return null;
	}
}

/** WebCrypto, or null when it is unavailable (insecure origin, old browser).
 * Callers treat null as "no unlock is possible", never as "let them in". */
function subtle(): SubtleCrypto | null {
	try {
		const c = globalThis.crypto;
		return c?.subtle && typeof c.getRandomValues === 'function' ? c.subtle : null;
	} catch {
		return null;
	}
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array | null> {
	const s = subtle();
	if (!s) return null;
	try {
		const key = await s.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
			'deriveBits',
		]);
		const bits = await s.deriveBits(
			{ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
			key,
			HASH_BYTES * 8
		);
		return new Uint8Array(bits);
	} catch {
		return null;
	}
}

/** Length-independent, data-independent comparison: an early return would
 * leak how much of the derived key matched. */
function equalsConstantTime(a: Uint8Array, b: Uint8Array): boolean {
	let diff = a.length ^ b.length;
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}

/**
 * Records the material needed to unlock this browser offline later. Called
 * with the password the user just authenticated with, at the one moment the
 * app legitimately holds it. Best-effort: if it cannot be stored, offline
 * unlock is simply unavailable and the read guard stays shut.
 */
export async function storeUnlockPasscode(password: string): Promise<void> {
	const s = subtle();
	if (!s) return;
	try {
		const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
		const hash = await derive(password, salt, PBKDF2_ITERATIONS);
		if (!hash) return;
		const rec: UnlockRecord = {
			v: 1,
			iterations: PBKDF2_ITERATIONS,
			salt: toBase64(salt),
			hash: toBase64(hash),
		};
		localStorage.setItem(RECORD_KEY, JSON.stringify(rec));
	} catch {
		// Storage full or unavailable — offline unlock just won't be offered.
	}
}

/** True when this browser can be unlocked offline at all. */
export function hasUnlockPasscode(): boolean {
	return readRecord() !== null && subtle() !== null;
}

/**
 * True when `password` matches the stored record. Every failure path — no
 * record, corrupt record, no WebCrypto, derivation error — returns false.
 * Callers must apply the throttle; this function does not.
 */
export async function verifyUnlockPasscode(password: string): Promise<boolean> {
	const rec = readRecord();
	if (!rec) return false;
	let expected: Uint8Array;
	try {
		expected = fromBase64(rec.hash);
	} catch {
		return false;
	}
	const actual = await derive(password, fromBase64(rec.salt), rec.iterations);
	if (!actual) return false;
	return equalsConstantTime(actual, expected);
}

/** Forgets the unlock material (logout, with the rest of the local footprint). */
export function clearUnlockPasscode(): void {
	try {
		localStorage.removeItem(RECORD_KEY);
		localStorage.removeItem(ATTEMPTS_KEY);
	} catch {
		// Nothing to clear if storage is unavailable.
	}
}

function readAttempts(): AttemptRecord {
	try {
		const raw = localStorage.getItem(ATTEMPTS_KEY);
		if (!raw) return { failures: 0, lockedUntil: 0 };
		const rec = JSON.parse(raw) as AttemptRecord;
		return {
			failures: typeof rec?.failures === 'number' ? rec.failures : 0,
			lockedUntil: typeof rec?.lockedUntil === 'number' ? rec.lockedUntil : 0,
		};
	} catch {
		return { failures: 0, lockedUntil: 0 };
	}
}

/**
 * Counts a wrong password and starts (or extends) the cooldown once the free
 * attempts are used up. Persisted, so reloading the page is not a way round
 * it — an attacker with DevTools can still clear it, which is the same
 * caveat the whole client-side gate carries.
 *
 * Deliberately does NOT wipe anything: unsynced offline edits exist only in
 * the local store, and destroying the owner's work because they mistyped
 * their own password would be a worse failure than a slow guess.
 */
export function recordFailedUnlock(now: number = Date.now()): void {
	const prev = readAttempts();
	const failures = prev.failures + 1;
	const over = failures - UNLOCK_FREE_ATTEMPTS;
	const lockedUntil =
		over > 0
			? now + Math.min(UNLOCK_BACKOFF_BASE_MS * 2 ** (over - 1), UNLOCK_BACKOFF_MAX_MS)
			: 0;
	try {
		localStorage.setItem(ATTEMPTS_KEY, JSON.stringify({ failures, lockedUntil }));
	} catch {
		// Best-effort; the KDF cost still throttles guessing.
	}
}

/** Milliseconds left before another attempt is accepted (0 when allowed). */
export function unlockLockoutRemainingMs(now: number = Date.now()): number {
	return Math.max(0, readAttempts().lockedUntil - now);
}

/** Clears the failure count after a successful unlock. */
export function resetUnlockAttempts(): void {
	try {
		localStorage.removeItem(ATTEMPTS_KEY);
	} catch {
		// Nothing to clear.
	}
}
