import { api, type User } from '$lib/api';

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
		} catch {
			user = null;
		} finally {
			loading = false;
		}
	},
	async login(username: string, password: string) {
		user = await api.auth.login(username, password);
	},
	async logout() {
		await api.auth.logout();
		user = null;
	},
	setUser(u: User | null) {
		user = u;
	},
};
