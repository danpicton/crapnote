import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const PASSWORD = 'admin123';
// A valid 1x1 transparent PNG. Comparing the bytes makes a cached 200
// distinguishable from an error response with an accidentally permissive status.
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD);
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

async function waitForControlledPage(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(() => caches.match('/').then(Boolean));
}

async function uploadImage(page: Page): Promise<string> {
  return page.evaluate(async (bytes) => {
    const data = new FormData();
    data.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'pixel.png');
    const response = await fetch('/api/images', { method: 'POST', body: data });
    if (!response.ok) throw new Error(`image upload failed: ${response.status}`);
    return ((await response.json()) as { url: string }).url;
  }, [...PNG]);
}

async function readImage(page: Page, url: string) {
  return page.evaluate(async (imageURL) => {
    const response = await fetch(imageURL, { cache: 'no-store' });
    return { status: response.status, bytes: [...new Uint8Array(await response.arrayBuffer())] };
  }, url);
}

async function imageCacheNames(page: Page): Promise<string[]> {
  return page.evaluate(() => caches.keys().then((keys) => keys.filter((key) => key.includes('-images-'))));
}

/** Install a byte-identical worker under a new script URL. This exercises the
 * browser's real install/activate/claim lifecycle and, importantly, gives the
 * new worker an empty in-memory client-proof map. */
async function replaceWorker(page: Page, tag: string) {
  await page.evaluate(async (workerTag) => {
    const target = `/service-worker.js?e2e-replacement=${encodeURIComponent(workerTag)}`;
    const changed = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('replacement worker did not take control')), 15_000);
      const listener = () => {
        if (navigator.serviceWorker.controller?.scriptURL.includes(`e2e-replacement=${workerTag}`)) {
          window.clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('controllerchange', listener);
          resolve();
        }
      };
      navigator.serviceWorker.addEventListener('controllerchange', listener);
    });
    await navigator.serviceWorker.register(target, { scope: '/', type: 'module' });
    await changed;
  }, tag);
}

async function cachedNote(page: Page, id: number): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    (noteID) =>
      new Promise((resolve) => {
        const open = indexedDB.open('crapnote-notes-v2');
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('notes', 'readonly').objectStore('notes').get(noteID);
          get.onsuccess = () => { db.close(); resolve((get.result as Record<string, unknown>) ?? null); };
          get.onerror = () => { db.close(); resolve(null); };
        };
        open.onerror = () => resolve(null);
      }),
    id,
  );
}

/** Write a dirty edit while keeping its real IDB transaction busy. The second
 * tab starts authentication after the put is queued but before it commits. */
function persistDirtyNoteSlowly(page: Page, id: number, title: string, signalKey: string) {
  return page.evaluate(
    ([noteID, dirtyTitle, key]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('crapnote-notes-v2');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('notes', 'readwrite');
          const store = tx.objectStore('notes');
          const get = store.get(noteID as number);
          get.onsuccess = () => {
            store.put({
              ...get.result,
              title: dirtyTitle,
              local_updated_at: new Date().toISOString(),
              is_dirty: true,
            });
            localStorage.setItem(key as string, 'queued');
            const deadline = performance.now() + 750;
            const keepAlive = () => {
              const request = store.get(noteID as number);
              request.onsuccess = () => {
                if (performance.now() < deadline) keepAlive();
              };
            };
            keepAlive();
          };
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        open.onerror = () => reject(open.error);
      }),
    [id, title, signalKey] as const,
  );
}

test.describe('Image-cache identity lifecycle', () => {
  test('a replacement worker recovers only the authorized page identity', async ({ context, page }) => {
    await login(page);
    await waitForControlledPage(page);
    await page.reload();
    await expect(page.locator('.app-name')).toBeVisible();

    const imageURL = await uploadImage(page);
    await expect.poll(async () => {
      const image = await readImage(page, imageURL);
      return { image, cacheCount: (await imageCacheNames(page)).length };
    }).toEqual({ image: { status: 200, bytes: [...PNG] }, cacheCount: 1 });

    // A second tab shares Cache Storage and IndexedDB, but has no proof in its
    // fresh sessionStorage. With /auth/me unreachable it stays locally locked.
    await context.route('**/api/auth/me', (route) => route.abort());
    const unproved = await context.newPage();
    await unproved.goto('/login');
    await expect(unproved.getByLabel(/^password for this account/i)).toBeVisible({ timeout: 15_000 });

    await replaceWorker(page, `${Date.now()}`);
    await unproved.waitForFunction(() =>
      navigator.serviceWorker.controller?.scriptURL.includes('e2e-replacement='),
    );

    // Force misses to fail at the network boundary. The proved page must
    // recover through the worker's client message; the other page must not.
    await context.route('**/api/images/**', (route) => route.abort());
    expect(await readImage(page, imageURL)).toEqual({ status: 200, bytes: [...PNG] });
    const denied = await readImage(unproved, imageURL);
    expect(denied.status).toBe(503);
    expect(denied.bytes).not.toEqual([...PNG]);
  });

  test('logout in one tab revokes the previous account cache from every tab', async ({ context, page }) => {
    await login(page);
    await waitForControlledPage(page);
    await page.reload();
    const imageURL = await uploadImage(page);
    await expect.poll(async () => {
      const image = await readImage(page, imageURL);
      return { status: image.status, cacheCount: (await imageCacheNames(page)).length };
    }).toEqual({ status: 200, cacheCount: 1 });

    const otherTab = await context.newPage();
    await otherTab.goto('/');
    await expect(otherTab.locator('.app-name')).toBeVisible();
    await context.route('**/api/images/**', (route) => route.abort());

    await otherTab.getByRole('button', { name: /log out/i }).click();
    await expect(otherTab).toHaveURL(/\/login/);
    await expect.poll(() => imageCacheNames(page)).toEqual([]);

    const denied = await readImage(page, imageURL);
    expect(denied.status).toBe(503);
    expect(denied.bytes).not.toEqual([...PNG]);
  });
});

test.describe('Authentication and pending offline persistence', () => {
  test('same-account auth initialization does not erase an overlapping dirty write', async ({
    context,
    page,
  }) => {
    await login(page);
    const runTag = Date.now().toString(36);
    const originalTitle = `Pending persistence ${runTag}`;
    const dirtyTitle = `Unsynced persistence ${runTag}`;
    const created = await context.request.post('/api/notes', {
      data: { title: originalTitle, body: `Body of ${originalTitle}` },
    });
    expect(created.ok()).toBeTruthy();
    const noteID = ((await created.json()) as { id: number }).id;

    await page.reload();
    await expect(page.getByText(originalTitle).first()).toBeVisible();
    await expect.poll(() => cachedNote(page, noteID)).not.toBeNull();

    const authTab = await context.newPage();
    await authTab.goto('/settings');
    await expect(authTab.getByRole('heading', { name: /settings/i }).first()).toBeVisible();

    const signalKey = `e2e:dirty-write:${runTag}`;
    const pendingWrite = persistDirtyNoteSlowly(page, noteID, dirtyTitle, signalKey);
    await authTab.waitForFunction((key) => localStorage.getItem(key) === 'queued', signalKey);

    const sessionCheck = authTab.waitForResponse(
      (response) => response.url().endsWith('/api/auth/me') && response.status() === 200,
    );
    await authTab.reload();
    await Promise.all([sessionCheck, pendingWrite]);

    await authTab.goto('/');
    await expect(authTab.getByText(dirtyTitle).first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => cachedNote(authTab, noteID)).toMatchObject({
      id: noteID,
      title: dirtyTitle,
      is_dirty: true,
    });

    // The server still has the old value: visibility came from the preserved
    // unsynced row, not from an unexpectedly completed online save.
    const serverNote = await context.request.get(`/api/notes/${noteID}`);
    expect(serverNote.ok()).toBeTruthy();
    expect((await serverNote.json()) as { title: string }).toMatchObject({ title: originalTitle });
  });
});
