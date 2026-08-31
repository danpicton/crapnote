import { api, ApiError, OfflineError, type User } from '$lib/api';
import {
	clearLocalData,
	ensureOfflineOwner,
	persistSessionUser,
	readSessionUser,
	clearSessionUser,
} from '$lib/localData';
import {
	storeUnlockPasscode,
	hasUnlockPasscode,
	verifyUnlockPasscode,
	recordFailedUnlock,
	resetUnlockAttempts,
	unlockLockoutRemainingMs,
} from '$lib/offlineUnlock';

let user = $state<User | null>(null);
let loading = $state(true);
/**
 * True when an identity was restored from local storage but no server has
 * confirmed it this session. The identity marker and the offline note store
 * sit in the same browser profile and survive a browser close together, so
 * one matching the other proves only that this is the same *machine* — not
 * the same *person*. Until the password is re-entered, nothing cached may be
 * read or rendered.
 */
let locked = $state(false);
/** Milliseconds left on the failed-attempt cooldown, for the unlock screen. */
let lockoutMs = $state(0);

// The in-flight session check, shared by every caller of init()/ready(), and
// whether one has ever completed. The root layout and a route guard both want
// the session on first paint but mount in an order they don't control, so the
// first of them starts the request and the rest join it.
let sessionCheck: Promise<void> | null = null;
let checked = false;

/**
 * Starts a session check, or returns the one already running. Dedupe matters
 * because the root layout and a page-level route guard both ask for the
 * session on first paint; without it that is two /api/auth/me requests racing
 * each other.
 */
function startSessionCheck(): Promise<void> {
	sessionCheck ??= loadSession().finally(() => {
		checked = true;
		sessionCheck = null;
	});
	return sessionCheck;
}

/**
 * Performs the one-shot session check. Callers go through init()/ready(),
 * which dedupe concurrent runs, rather than calling this directly.
 */
async function loadSession(): Promise<void> {
	loading = true;
	try {
		user = await api.auth.me();
		// The server vouched for this session, so there is nothing to unlock.
		locked = false;
		persistSessionUser(user);
		await ensureOfflineOwner(user.id);
	} catch (err) {
		if (err instanceof OfflineError) {
			// Offline start: /api/auth/me is unreachable, so restore the
			// identity persisted at the last successful login/session
			// check. Without this the PWA bounces to /login in airplane
			// mode even though the user's notes are cached locally.
			//
			// Restoring it does NOT mean trusting it: nobody has proved who
			// they are, so the session comes back locked and the password
			// has to be re-entered before any cached row is read. And if
			// this browser holds no unlock material — an install from
			// before unlock shipped, or no WebCrypto — there is no way to
			// prove ownership at all, so the identity is not restored
			// either. Fail closed; never "no passcode, therefore let them in".
			const remembered = readSessionUser();
			if (remembered && hasUnlockPasscode()) {
				user = remembered;
				locked = true;
				lockoutMs = unlockLockoutRemainingMs();
				await ensureOfflineOwner(user.id);
			} else {
				user = null;
				locked = false;
			}
		} else {
			// The server answered but this session isn't usable right now.
			user = null;
			locked = false;
			// Forget the persisted identity only on a genuine auth
			// rejection — a transient 5xx (reachable proxy, backend
			// restarting) must not strand the next offline start on
			// /login while the session cookie is still valid.
			if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
				clearSessionUser();
			}
		}
	} finally {
		loading = false;
	}
}

export const auth = {
	get user() {
		return user;
	},
	get loading() {
		return loading;
	},
	/** True while a restored-but-unproven identity is waiting for its password. */
	get locked() {
		return locked;
	},
	/** Milliseconds left on the failed-attempt cooldown (0 when attempts are allowed). */
	get unlockLockoutMs() {
		return lockoutMs;
	},
	/**
	 * The single question every cached-data reader asks: is there a user, and
	 * has this browser been proved to belong to them?
	 */
	get canReadCache() {
		return user !== null && !locked;
	},
	init: startSessionCheck,
	/**
	 * Resolves once the session state is trustworthy: joins an in-flight
	 * check, returns immediately if one has already completed, and otherwise
	 * starts one. Route guards must await this before reading `user` —
	 * a child page's `onMount` runs before the root layout's, so at mount
	 * time `user` is still null and `loading` still true on every full page
	 * load.
	 */
	ready(): Promise<void> {
		if (sessionCheck) return sessionCheck;
		return checked ? Promise.resolve() : startSessionCheck();
	},

	/**
	 * Verifies the password locally and lifts the lock. Returns false — and
	 * leaves the session locked — for a wrong password or while a cooldown is
	 * running. The throttle is checked BEFORE the KDF runs, so a caller
	 * cannot spend the cooldown deriving keys.
	 */
	async unlock(password: string): Promise<boolean> {
		const remaining = unlockLockoutRemainingMs();
		if (remaining > 0) {
			lockoutMs = remaining;
			return false;
		}
		if (await verifyUnlockPasscode(password)) {
			resetUnlockAttempts();
			lockoutMs = 0;
			locked = false;
			return true;
		}
		recordFailedUnlock();
		lockoutMs = unlockLockoutRemainingMs();
		return false;
	},

	async login(username: string, password: string) {
		user = await api.auth.login(username, password);
		locked = false;
		// The one moment the app legitimately holds the password: derive and
		// keep the material that lets this browser be unlocked offline later.
		// Only the salt, the KDF parameters and the derived bytes are stored.
		await storeUnlockPasscode(password);
		resetUnlockAttempts();
		lockoutMs = 0;
		// A successful login IS a settled session check, so ready() must not
		// go fetch /api/auth/me again: the notes page awaits it before it
		// will read the offline store, and an extra round-trip there would
		// delay the first paint after every login for no new information.
		checked = true;
		persistSessionUser(user);
		await ensureOfflineOwner(user.id);
	},
	async logout() {
		try {
			await api.auth.logout();
		} finally {
			// Even if the server call fails, this browser must forget the
			// user: cached /api responses and the offline note store would
			// otherwise be readable by (and sync under) the next account.
			user = null;
			locked = false;
			lockoutMs = 0;
			await clearLocalData();
		}
	},
	setUser(u: User | null) {
		user = u;
	},
};
