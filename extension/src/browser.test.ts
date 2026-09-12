import { afterEach, describe, expect, it, vi } from 'vitest';

function extensionAPI() {
	return {
		storage: {
			sync: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
			local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
		},
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('browser API adapter', () => {
	it('uses chrome when the browser namespace is unavailable', async () => {
		const chromeAPI = extensionAPI();
		vi.stubGlobal('browser', undefined);
		vi.stubGlobal('chrome', chromeAPI);

		const { ext } = await import('./browser');

		expect(ext).toBe(chromeAPI);
	});

	it('prefers the Firefox browser namespace', async () => {
		const chromeAPI = extensionAPI();
		const browserAPI = extensionAPI();
		vi.stubGlobal('chrome', chromeAPI);
		vi.stubGlobal('browser', browserAPI);

		const { ext } = await import('./browser');

		expect(ext).toBe(browserAPI);
	});

	it('routes sync and local stores to their respective namespaces', async () => {
		const chromeAPI = extensionAPI();
		chromeAPI.storage.sync.get.mockResolvedValue({ theme: 'dark' });
		chromeAPI.storage.local.get.mockResolvedValue({ apiToken: 'secret' });
		vi.stubGlobal('browser', undefined);
		vi.stubGlobal('chrome', chromeAPI);
		const { syncStore, localStore } = await import('./browser');

		await expect(syncStore().get(['theme'])).resolves.toEqual({ theme: 'dark' });
		await syncStore().set({ theme: 'light' });
		await syncStore().remove(['theme']);
		await expect(localStore().get(['apiToken'])).resolves.toEqual({ apiToken: 'secret' });
		await localStore().set({ apiToken: 'new' });
		await localStore().remove(['apiToken']);

		expect(chromeAPI.storage.sync.set).toHaveBeenCalledWith({ theme: 'light' });
		expect(chromeAPI.storage.sync.remove).toHaveBeenCalledWith(['theme']);
		expect(chromeAPI.storage.local.set).toHaveBeenCalledWith({ apiToken: 'new' });
		expect(chromeAPI.storage.local.remove).toHaveBeenCalledWith(['apiToken']);
	});
});
