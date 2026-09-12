import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: { data?: unknown }) => void;

class TestMessageChannel {
	port1: { onmessage: Listener | null } = { onmessage: null };
	port2 = { reply: () => this.port1.onmessage?.({}) };
}

function serviceWorkerContainer(controller: { postMessage: ReturnType<typeof vi.fn> } | null = null) {
	const listeners = new Map<string, Listener>();
	return {
		controller,
		register: vi.fn().mockResolvedValue({ scope: '/' }),
		getRegistration: vi.fn().mockResolvedValue(undefined),
		addEventListener: vi.fn((type: string, listener: Listener) => listeners.set(type, listener)),
		listeners,
	};
}

function worker() {
	return {
		postMessage: vi.fn((_message: unknown, ports: Array<{ reply: () => void }>) => {
			ports[0].reply();
		}),
	};
}

async function freshModule() {
	vi.resetModules();
	return import('./sw-register');
}

beforeEach(() => {
	vi.stubGlobal('MessageChannel', TestMessageChannel);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('service worker registration', () => {
	it('does nothing when service workers are unsupported', async () => {
		Reflect.deleteProperty(navigator, 'serviceWorker');
		const { registerSW, setImageCacheIdentity } = await freshModule();

		await expect(registerSW()).resolves.toBeUndefined();
		await expect(setImageCacheIdentity(4)).resolves.toBeUndefined();
	});

	it('registers the module worker and installs lifecycle listeners only once', async () => {
		const sw = serviceWorkerContainer();
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const { registerSW } = await freshModule();

		await registerSW();
		await registerSW();

		expect(sw.register).toHaveBeenCalledTimes(2);
		expect(sw.register).toHaveBeenCalledWith('/service-worker.js', { scope: '/', type: 'module' });
		expect(sw.addEventListener).toHaveBeenCalledTimes(2);
		expect(sw.listeners.has('controllerchange')).toBe(true);
		expect(sw.listeners.has('message')).toBe(true);
	});

	it('publishes and restores the current image-cache identity', async () => {
		const activeWorker = worker();
		const sw = serviceWorkerContainer(activeWorker);
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const { registerSW, setImageCacheIdentity } = await freshModule();

		await setImageCacheIdentity(7);
		await registerSW();
		sw.listeners.get('controllerchange')?.({});
		sw.listeners.get('message')?.({ data: { type: 'crapnote:request-image-cache-identity' } });
		await vi.waitFor(() => expect(activeWorker.postMessage).toHaveBeenCalledTimes(3));

		for (const [message, ports] of activeWorker.postMessage.mock.calls) {
			expect(message).toEqual({ type: 'crapnote:image-cache-identity', userId: 7 });
			expect(ports).toHaveLength(1);
		}
	});

	it('uses an active registration when the page has no controller', async () => {
		const activeWorker = worker();
		const sw = serviceWorkerContainer();
		sw.getRegistration.mockResolvedValue({ active: activeWorker });
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });
		const { setImageCacheIdentity } = await freshModule();

		await setImageCacheIdentity(null);

		expect(sw.getRegistration).toHaveBeenCalledWith('/');
		expect(activeWorker.postMessage).toHaveBeenCalledWith(
			{ type: 'crapnote:image-cache-identity', userId: null },
			expect.any(Array)
		);
	});

	it('contains registration and messaging failures', async () => {
		const brokenWorker = { postMessage: vi.fn(() => { throw new Error('worker gone'); }) };
		const sw = serviceWorkerContainer(brokenWorker);
		sw.register.mockRejectedValue(new Error('registration denied'));
		Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw });
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { registerSW, setImageCacheIdentity } = await freshModule();

		await expect(setImageCacheIdentity(2)).resolves.toBeUndefined();
		await expect(registerSW()).resolves.toBeUndefined();

		expect(console.warn).toHaveBeenCalledWith('[SW] registration failed', expect.any(Error));
	});
});
