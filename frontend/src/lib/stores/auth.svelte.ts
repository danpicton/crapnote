import { api, ApiError, OfflineError, type User } from '$lib/api';
import {
	clearLocalData,
	ensureOfflineOwner,
	persistSessionUser,
	readSessionUser,
	clearSessionUser,
} from '$lib/localData';

let user = $state<User | null>(null);
let loading = $state(true);

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
		persistSessionUser(user);
		await ensureOfflineOwner(user.id);
	} catch (err) {
		if (err instanceof OfflineError) {
			// Offline start: /api/auth/me is unreachable, so restore the
			// identity persisted at the last successful login/session
			// check. Without this the PWA bounces to /login in airplane
			// mode even though the user's notes are cached locally.
			user = readSessionUser();
			if (user) await ensureOfflineOwner(user.id);
		} else {
			// The server answered but this session isn't usable right now.
			user = null;
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

	async login(username: string, password: string) {
		user = await api.auth.login(username, password);
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
			await clearLocalData();
		}
	},
	setUser(u: User | null) {
		user = u;
	},
};
