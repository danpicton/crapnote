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

export const auth = {
	get user() {
		return user;
	},
	get loading() {
		return loading;
	},
	async init() {
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
