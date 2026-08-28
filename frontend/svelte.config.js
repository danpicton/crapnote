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
		},
		// Content-Security-Policy, build-time half (issue #90). SvelteKit hashes
		// the inline bootstrap it generates and emits the policy below into
		// index.html as <meta http-equiv="content-security-policy">, because
		// adapter-static has no server to set a header. That is what lets
		// script-src drop 'unsafe-inline': the bootstrap's SHA-256 changes on
		// every build (it embeds a per-build random global and the content-hashed
		// chunk names), so only the build itself can state it.
		//
		// The Go middleware sends the other half — frame-ancestors, which browsers
		// ignore in a meta tag. Both policies are enforced at once and a resource
		// must satisfy each, so the two halves are disjoint on purpose: nothing
		// here is repeated there. docs/csp.md owns the full split and the reasons;
		// read it before changing either side. src/csp.test.ts pins this object.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				// No 'unsafe-inline': SvelteKit appends the bootstrap's hash here.
				'script-src': ['self'],
				// 'unsafe-inline' stays. ProseMirror writes style attributes at
				// runtime and app.html's shell uses one, and style attributes
				// cannot be hash-allowlisted without 'unsafe-hashes'. Keeping it
				// also stops SvelteKit hashing the inline <style> block, which
				// would otherwise make browsers ignore 'unsafe-inline'.
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'font-src': ['self', 'https://fonts.gstatic.com'],
				// https: is deliberate: notes hold remote image URLs (pasted
				// markdown, extension hot-link fallback) that must keep rendering.
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'connect-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['none'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
