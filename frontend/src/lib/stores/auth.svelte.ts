import { api, type User } from '$lib/api';
import { clearLocalData, ensureOfflineOwner } from '$lib/localData';

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
			await ensureOfflineOwner(user.id);
		} catch {
			user = null;
		} finally {
			loading = false;
		}
	},
	async login(username: string, password: string) {
		user = await api.auth.login(username, password);
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
