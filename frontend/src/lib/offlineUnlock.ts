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
	v: 2;
	/** The account this record unlocks. A record left behind by one user must
	 * not open another's store, and the id is mixed into the derived key as
	 * well as checked, so the two cannot be separated by editing the JSON. */
	userId: number;
	iterations: number;
	salt: string;
	hash: string;
}

/** A record whose salt and hash have already been decoded, so no caller can
 * be surprised by a decode failure part-way through verification. */
interface DecodedRecord {
	userId: number;
	iterations: number;
	salt: Uint8Array;
	hash: Uint8Array;
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

/**
 * Reads and fully decodes the stored record, or null if it is absent,
 * unparseable, incomplete, for another account, or carries a salt or hash
 * that is not valid base64.
 *
 * Decoding BOTH fields here is the point: doing it lazily at the comparison
 * left a record that parsed but could not be decoded, which made
 * `verifyUnlockPasscode` reject instead of returning false — a lock the owner
 * could never open, with no error shown.
 */
function readRecord(userId: number): DecodedRecord | null {
	try {
		const raw = localStorage.getItem(RECORD_KEY);
		if (!raw) return null;
		const rec = JSON.parse(raw) as UnlockRecord;
		if (rec?.v !== 2) return null;
		if (typeof rec.userId !== 'number' || rec.userId !== userId) return null;
		if (typeof rec.iterations !== 'number' || rec.iterations < 1) return null;
		if (typeof rec.salt !== 'string' || typeof rec.hash !== 'string') return null;
		if (!rec.salt || !rec.hash) return null;
		return {
			userId: rec.userId,
			iterations: rec.iterations,
			salt: fromBase64(rec.salt),
			hash: fromBase64(rec.hash),
		};
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

/**
 * Derives the key for `userId`'s password. The account id is part of the KDF
 * input, not just a field beside it, so a record cannot be repointed at
 * another account by editing the stored JSON.
 */
async function derive(
	userId: number,
	password: string,
	salt: Uint8Array,
	iterations: number
): Promise<Uint8Array | null> {
	const s = subtle();
	if (!s) return null;
	try {
		const material = new TextEncoder().encode(`crapnote:v2:${userId}\u0000${password}`);
		const key = await s.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
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
export async function storeUnlockPasscode(userId: number, password: string): Promise<void> {
	const s = subtle();
	if (!s) return;
	try {
		const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
		const hash = await derive(userId, password, salt, PBKDF2_ITERATIONS);
		if (!hash) return;
		const rec: UnlockRecord = {
			v: 2,
			userId,
			iterations: PBKDF2_ITERATIONS,
			salt: toBase64(salt),
			hash: toBase64(hash),
		};
		localStorage.setItem(RECORD_KEY, JSON.stringify(rec));
	} catch {
		// Storage full or unavailable — offline unlock just won't be offered.
	}
}

/** True when this browser holds usable unlock material for `userId`. */
export function hasUnlockPasscode(userId: number): boolean {
	return readRecord(userId) !== null && subtle() !== null;
}

/**
 * True when `password` matches the record stored for `userId`. Every failure
 * path — no record, a record for another account, corrupt or undecodable
 * data, no WebCrypto, derivation error — returns false; this never rejects.
 * Callers must apply the throttle; this function does not.
 */
export async function verifyUnlockPasscode(userId: number, password: string): Promise<boolean> {
	const rec = readRecord(userId);
	if (!rec) return false;
	const actual = await derive(userId, password, rec.salt, rec.iterations);
	if (!actual) return false;
	return equalsConstantTime(actual, rec.hash);
}

/** Forgets the unlock material (logout, with the rest of the local footprint). */
export function clearUnlockPasscode(): void {
	clearIdentityProof();
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

/**
 * Ceiling on how long a proof of identity stays good inside one browsing
 * session. Bounds a browser left open and unattended overnight without ever
 * interrupting a normal working day.
 */
export const UNLOCK_PROOF_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const PROOF_KEY = 'crapnote:offline-unlock-session';

interface ProofRecord {
	userId: number;
	at: number;
}

/**
 * Records that this identity was proved — a session the server vouched for, a
 * fresh login, or a successful unlock.
 *
 * Deliberately in sessionStorage, not localStorage. sessionStorage survives a
 * reload and same-tab navigation but dies with the tab or PWA window, which
 * is the exact line issue #61 draws: A "closes the browser without logging
 * out", and the next person opens the app afresh. Keeping this beside the
 * store in localStorage would recreate the very hole the unlock closes.
 */
export function markIdentityProved(userId: number, now: number = Date.now()): void {
	try {
		sessionStorage.setItem(PROOF_KEY, JSON.stringify({ userId, at: now } satisfies ProofRecord));
	} catch {
		// Storage unavailable — the user is asked to unlock instead, which is
		// the safe direction.
	}
}

/**
 * True when `userId` was proved in this browsing session and that proof is
 * still young enough. Every failure path — no record, wrong account, corrupt
 * data, unavailable storage, expired — returns false, so a reload is only
 * ever spared the prompt on positive evidence.
 */
export function identityProvedInThisSession(userId: number, now: number = Date.now()): boolean {
	try {
		const raw = sessionStorage.getItem(PROOF_KEY);
		if (!raw) return false;
		const rec = JSON.parse(raw) as ProofRecord;
		if (typeof rec?.userId !== 'number' || typeof rec?.at !== 'number') return false;
		if (rec.userId !== userId) return false;
		return now - rec.at < UNLOCK_PROOF_MAX_AGE_MS;
	} catch {
		return false;
	}
}

/** Drops the proof (logout, with the rest of the local footprint). */
export function clearIdentityProof(): void {
	try {
		sessionStorage.removeItem(PROOF_KEY);
	} catch {
		// Nothing to clear.
	}
}
