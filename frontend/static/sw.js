/// <reference lib="webworker" />

// Bump this version whenever you want to force a cache refresh.
// v3: switched navigation requests to network-first so soft-refresh picks up
// new deploys instead of serving a stale `/` shell that references old
// content-hashed `/_app/immutable/*` assets the server no longer has.
const CACHE_NAME = 'crapnote-v3';

// ─── Install: precache the app shell + ALL /_app/ assets ──────────────────────
self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			try {
				// Fetch the app shell HTML and cache it
				const shellRes = await fetch('/', { cache: 'reload' });
				if (shellRes.ok) {
					await cache.put('/', shellRes.clone());

					// Parse the HTML to discover all SvelteKit-generated assets
					// (modulepreload, stylesheet, and script references under /_app/)
					const html = await shellRes.text();
					const assetUrls = new Set();
					const re = /["'](\/_app\/[^"'?#]+)["']/g;
					let m;
					while ((m = re.exec(html)) !== null) assetUrls.add(m[1]);

					// Cache every discovered asset in parallel
					await Promise.allSettled(
						Array.from(assetUrls).map(async (url) => {
							const res = await fetch(url, { cache: 'reload' });
							if (res.ok) await cache.put(url, res);
						})
					);
				}

				// Also precache the login page
				const loginRes = await fetch('/login', { cache: 'reload' });
				if (loginRes.ok) await cache.put('/login', loginRes.clone());
			} catch {
				// If we're offline during install just skip precaching — the
				// cache-first handler will populate the cache on the next online visit.
			}

			// Take control immediately without waiting for old SW to go away.
			await self.skipWaiting();
		})()
	);
});

// ─── Activate: purge old caches, claim all open pages ─────────────────────────
self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
			)
			.then(() => self.clients.claim())
	);
});

// ─── Fetch: route API vs. static ──────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// Only handle same-origin requests
	if (url.origin !== self.location.origin) return;

	if (url.pathname.startsWith('/api/')) {
		// API requests: network-first; queue mutating requests when offline
		const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
		event.respondWith(isWrite ? networkOrQueue(request) : networkFirst(request));
		return;
	}

	// Top-level HTML document loads (soft-refresh, link clicks, address bar)
	// must be network-first. If we served the cached shell here, a redeploy
	// would leave users with HTML that references `/_app/immutable/*` asset
	// hashes the server no longer has, and every soft refresh would 404.
	// The cached shell is only used as the offline fallback.
	if (request.mode === 'navigate') {
		event.respondWith(navigationNetworkFirst(request));
		return;
	}

	// Hashed bundles under /_app/immutable/* and other static assets: cache-first.
	event.respondWith(cacheFirst(request));
});

// ─── Strategy helpers ─────────────────────────────────────────────────────────

/**
 * Always hit the network for navigation requests so new deploys load cleanly.
 * On success, refresh the cached `/` shell so the next offline visit boots.
 * On failure (offline), fall back to the cached shell if we have one.
 */
async function navigationNetworkFirst(request) {
	try {
		const response = await fetch(request);
		if (response.ok) {
			const cache = await caches.open(CACHE_NAME);
			// Always key the shell under `/` so offline fallback is predictable
			// regardless of which path the user navigated to.
			cache.put('/', response.clone());
		}
		return response;
	} catch {
		const cached = (await caches.match(request)) ?? (await caches.match('/'));
		if (cached) return cached;
		return new Response('Offline', { status: 503 });
	}
}

async function networkFirst(request) {
	try {
		const response = await fetch(request);
		if (response.ok) {
			const cache = await caches.open(CACHE_NAME);
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		const cached = await caches.match(request);
		return (
			cached ??
			new Response('{"error":"offline"}', {
				status: 503,
				headers: { 'Content-Type': 'application/json' },
			})
		);
	}
}

async function cacheFirst(request) {
	const cached = await caches.match(request);
	if (cached) return cached;
	try {
		const response = await fetch(request);
		if (response.ok) {
			const cache = await caches.open(CACHE_NAME);
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		// Return offline page for navigation requests; 503 for assets
		if (request.mode === 'navigate') {
			const shell = await caches.match('/');
			if (shell) return shell;
		}
		return new Response('Offline', { status: 503 });
	}
}

async function networkOrQueue(request) {
	try {
		return await fetch(request.clone());
	} catch {
		await enqueue(request);
		return new Response(JSON.stringify({ queued: true }), {
			status: 202,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

// ─── Offline write queue (IndexedDB) ──────────────────────────────────────────

async function enqueue(request) {
	const body = await request.text();
	const entry = {
		url: request.url,
		method: request.method,
		headers: Object.fromEntries(request.headers.entries()),
		body,
		timestamp: Date.now(),
	};
	const db = await openDB();
	const tx = db.transaction('queue', 'readwrite');
	tx.objectStore('queue').add(entry);
	await new Promise((resolve, reject) => {
		tx.oncomplete = resolve;
		tx.onerror = () => reject(tx.error);
	});
}

async function flushQueue() {
	const db = await openDB();
	const tx = db.transaction('queue', 'readwrite');
	const store = tx.objectStore('queue');
	const entries = await new Promise((resolve, reject) => {
		const req = store.getAll();
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	for (const entry of entries) {
		try {
			const response = await fetch(entry.url, {
				method: entry.method,
				headers: entry.headers,
				body: entry.body || undefined,
			});
			if (response.ok) store.delete(entry.id);
		} catch {
			break; // still offline
		}
	}
}

function openDB() {
	return new Promise((resolve, reject) => {
		const req = self.indexedDB.open('crapnote-offline', 1);
		req.onupgradeneeded = (e) => {
			const db = e.target.result;
			if (!db.objectStoreNames.contains('queue')) {
				db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

self.addEventListener('sync', (event) => {
	if (event.tag === 'flush-offline-queue') event.waitUntil(flushQueue());
});

self.addEventListener('message', (event) => {
	if (event.data?.type === 'FLUSH_QUEUE') event.waitUntil(flushQueue());
});
