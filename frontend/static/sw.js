/// <reference lib="webworker" />

const CACHE_NAME = 'crapnote-v1';
const OFFLINE_QUEUE_KEY = 'offline-queue';

// Static assets to cache on install
const PRECACHE_URLS = ['/', '/login'];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(PRECACHE_URLS))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// For API requests: network-first, queue writes when offline
	if (url.pathname.startsWith('/api/')) {
		const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
		if (isWrite) {
			event.respondWith(networkOrQueue(request));
		} else {
			event.respondWith(networkFirst(request));
		}
		return;
	}

	// Static assets: cache-first
	event.respondWith(cacheFirst(request));
});

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
		return cached ?? new Response('{"error":"offline"}', {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		});
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
		return new Response('Offline', { status: 503 });
	}
}

async function networkOrQueue(request) {
	try {
		return await fetch(request.clone());
	} catch {
		// Offline: queue the request for later replay
		await enqueue(request);
		return new Response(JSON.stringify({ queued: true }), {
			status: 202,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

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
			if (response.ok) {
				store.delete(entry.id);
			}
		} catch {
			// Still offline, leave in queue
			break;
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

// Flush queued requests when back online
self.addEventListener('sync', (event) => {
	if (event.tag === 'flush-offline-queue') {
		event.waitUntil(flushQueue());
	}
});

// Also flush on message from page
self.addEventListener('message', (event) => {
	if (event.data?.type === 'FLUSH_QUEUE') {
		event.waitUntil(flushQueue());
	}
});
