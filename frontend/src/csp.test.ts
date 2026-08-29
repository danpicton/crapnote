import { describe, it, expect } from 'vitest';
import config from '../svelte.config.js';
// ?raw hands the shell to the test as a string — no node:fs, which the
// frontend's tsconfig has no types for.
import shell from './app.html?raw';

// The Content-Security-Policy the browser enforces on the SPA is assembled from
// two halves (see docs/csp.md): the directives below, which SvelteKit bakes into
// index.html as a <meta> tag with the hash of its inline bootstrap appended to
// script-src, and `frame-ancestors 'none'`, which the Go middleware sends as a
// header because browsers ignore it in meta. Both are enforced at once and a
// resource must satisfy each, so these tests guard the build-time half; the
// header half is pinned in backend/internal/middleware/middleware_test.go.
const csp = config.kit?.csp;
const directives = (csp?.directives ?? {}) as unknown as Record<string, string[] | undefined>;

/** Sources that cannot reach another origin at all. */
const firstParty = new Set(['self', 'none', 'data:', 'blob:']);

describe('CSP build-time policy (svelte.config.js)', () => {
	it('computes hashes at build time rather than issuing a nonce', () => {
		// A nonce would have to be minted per request and written into the HTML;
		// the backend serves the embedded build verbatim and never rewrites it.
		expect(csp?.mode).toBe('hash');
	});

	it('does not grant script-src unsafe-inline', () => {
		// The whole point of issue #90: with 'unsafe-inline' the policy does not
		// block injected script. SvelteKit appends the bootstrap's sha256 to this
		// list at build time, which is why 'self' alone is enough here.
		expect(directives['script-src']).toEqual(['self']);
	});

	it('keeps style-src unsafe-inline', () => {
		// ProseMirror sets style attributes at runtime and the shell's body
		// wrapper carries one; style attributes cannot be hash-allowlisted without
		// 'unsafe-hashes', and SvelteKit hashes only the component styles it
		// inlines itself, so nothing here could cover them.
		expect(directives['style-src']).toContain('unsafe-inline');
	});

	it('grants unsafe-inline to style-src and nothing else, and unsafe-eval to nothing', () => {
		for (const [name, sources] of Object.entries(directives)) {
			for (const source of sources ?? []) {
				if (source === 'unsafe-inline') {
					expect(name).toBe('style-src');
				}
				expect(source).not.toContain('unsafe-eval');
				expect(source).not.toContain('unsafe-hashes');
			}
		}
	});

	it('pins the scripted-request and form-submission channels to self', () => {
		// One appended origin reopens the channel, so these are equality checks.
		expect(directives['connect-src']).toEqual(['self']);
		expect(directives['form-action']).toEqual(['self']);
	});

	it('closes plugin execution and base-tag hijacking', () => {
		expect(directives['object-src']).toEqual(['none']);
		expect(directives['base-uri']).toEqual(['none']);
	});

	it('keeps img-src open to https so remote images in notes still render', () => {
		// Deliberate: notes hold remote image URLs from pasted markdown and from
		// the extension's hot-link fallback. Images cannot execute script.
		expect(directives['img-src']).toContain('https:');
	});

	it('names every off-site origin it allows', () => {
		// Anything else — a new host, a wildcard, or a bare scheme in a directive
		// that should not have one — fails and has to be argued for in review.
		const offSite: Record<string, Set<string>> = {
			'style-src': new Set(['https://fonts.googleapis.com']), // webfont stylesheets
			'font-src': new Set(['https://fonts.gstatic.com']), // webfont files
			'img-src': new Set(['https:']), // remote images in notes
		};
		for (const [name, sources] of Object.entries(directives)) {
			for (const source of sources ?? []) {
				if (firstParty.has(source) || source === 'unsafe-inline') continue;
				expect(source).not.toContain('*');
				expect(offSite[name]?.has(source), `undeclared off-site source ${source} in ${name}`).toBe(
					true,
				);
			}
		}
	});

	it('leaves frame-ancestors to the response header', () => {
		// Browsers ignore frame-ancestors in a <meta> tag, so listing it here
		// would look like protection while providing none. The Go middleware
		// sends it, and its test asserts it agrees with X-Frame-Options.
		expect(directives['frame-ancestors']).toBeUndefined();
	});
});

describe('CSP-sensitive shell markup (app.html)', () => {
	it('has no inline script for the policy to block', () => {
		// SvelteKit hashes only the bootstrap it generates itself; an inline
		// <script> in the shell is emitted verbatim and unhashed. Worse, the
		// shell's head is parsed before %sveltekit.head% emits the meta tag, so
		// such a script runs outside the policy rather than visibly breaking. The
		// webfont loader lives in static/fonts.js for exactly this reason.
		const scriptTags = shell.match(/<script[^>]*>/g) ?? [];
		for (const tag of scriptTags) {
			expect(tag, `inline <script> in app.html would be blocked: ${tag}`).toContain('src=');
		}
	});
});
