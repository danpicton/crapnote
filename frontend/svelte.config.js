import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: false
		}),
		// We register the service worker manually from sw-register.ts so we can
		// also wire up the online → flush-queue background sync hook there.
		serviceWorker: {
			register: false
		}
	}
};

export default config;
