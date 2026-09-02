import { test, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Issue #61: the offline note store outlives a session. `clearLocalData()`
 * runs on an explicit logout and on nothing else, so a browser that was
 * merely closed — a crash, someone walking away from a shared machine —
 * still holds the last user's note titles and bodies on disk.
 *
 * The store's owner id is no defence on its own: it lives in the same browser
 * profile as the `crapnote:session-user` marker the app restores its identity
 * from when offline, and the two survive a browser close TOGETHER. So
 * `owner === auth.user.id` is satisfied by whoever opens the app next. This
 * spec therefore carries the whole profile over — IndexedDB, the marker and
 * the unlock record — which is what actually happens, and asserts that the
 * password gate stops the next person anyway.
 *
 * Two mechanics worth knowing before editing this file:
 *
 *  - `context.setOffline(true)` is NOT honoured for service-worker-proxied
 *    `/api` traffic after a subsequent navigation: `/api/auth/me` comes back
 *    as a real 401 from the live server, which clears the marker and would
 *    make these assertions pass for entirely the wrong reason. So the offline
 *    phase blocks service workers and aborts `/api/**` at the route level —
 *    the real server still serves the app shell, exactly as it would if only
 *    the backend were down — and the precondition (the API request really did
 *    fail) is asserted before any leak assertion is trusted.
 *
 *  - The DOM check alone is a race: the layout can swap in the unlock screen
 *    before a cached row paints. The init script therefore also latches every
 *    transaction over the `notes` store, so "the rows were never even read" is
 *    deterministic. Owner/meta reads are deliberately not latched — those are
 *    the guard doing its job.
 */

const DB_NAME = 'crapnote-notes-v2';
const DB_VERSION = 2;
const MARKER_KEY = 'crapnote:session-user';
const UNLOCK_KEY = 'crapnote:offline-unlock';

const PASSWORD = 'admin123';

type Profile = {
  notes: unknown[];
  owner: number | null;
  marker: string | null;
  unlock: string | null;
};

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill(PASSWORD);
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** Waits until the SW controls the page and the shell is cached, so user A's
 * list load actually populates the offline store. */
async function waitForOfflineReadiness(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(() => caches.match('/').then((res) => !!res));
}

/** Everything a closed browser leaves behind for the next person. */
function dumpProfile(page: Page): Promise<Profile> {
  return page.evaluate(
    ([name, markerKey, unlockKey]) =>
      new Promise<Profile>((resolve) => {
        const marker = localStorage.getItem(markerKey);
        const unlock = localStorage.getItem(unlockKey);
        const req = indexedDB.open(name);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['notes', 'meta'], 'readonly');
          const notesReq = tx.objectStore('notes').getAll();
          const ownerReq = tx.objectStore('meta').get('owner');
          tx.oncomplete = () => {
            db.close();
            const row = ownerReq.result as { userId: number } | undefined;
            resolve({
              notes: notesReq.result as unknown[],
              owner: row?.userId ?? null,
              marker,
              unlock,
            });
          };
        };
        req.onerror = () => resolve({ notes: [], owner: null, marker, unlock });
      }),
    [DB_NAME, MARKER_KEY, UNLOCK_KEY] as const,
  );
}

/** Restores a captured profile into the current context. `withUnlock` false
 * models an install from before local unlock shipped. */
function seedProfile(page: Page, profile: Profile, withUnlock = true): Promise<void> {
  return page.evaluate(
    ([name, version, markerKey, unlockKey, snap, keepUnlock]) =>
      new Promise<void>((resolve, reject) => {
        const data = snap as Profile;
        if (data.marker) localStorage.setItem(markerKey as string, data.marker);
        if (keepUnlock && data.unlock) localStorage.setItem(unlockKey as string, data.unlock);
        const req = indexedDB.open(name as string, version as number);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['notes', 'meta'], 'readwrite');
          for (const n of data.notes) tx.objectStore('notes').put(n);
          if (data.owner !== null) tx.objectStore('meta').put({ key: 'owner', userId: data.owner });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    [DB_NAME, DB_VERSION, MARKER_KEY, UNLOCK_KEY, profile, withUnlock] as const,
  );
}

/** Latches, from before any app script runs, both a sighting of `secret` in
 * the DOM and any transaction over the cached notes store. */
async function watchForLeak(page: Page, secret: string) {
  await page.addInitScript(
    ([needle, dbName]: [string, string]) => {
      const w = window as unknown as { __leaked?: boolean; __readNotes?: boolean };
      w.__leaked = false;
      w.__readNotes = false;

      const openTx = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (names, ...rest) {
        const wanted = typeof names === 'string' ? [names] : Array.from(names);
        if (this.name === dbName && wanted.includes('notes')) w.__readNotes = true;
        return openTx.call(this, names, ...(rest as [IDBTransactionMode?]));
      };

      const scan = () => {
        if (w.__leaked) return;
        if ((document.documentElement?.textContent ?? '').includes(needle)) {
          w.__leaked = true;
          return;
        }
        for (const el of Array.from(document.querySelectorAll('input, textarea'))) {
          if ((el as HTMLInputElement).value?.includes(needle)) {
            w.__leaked = true;
            return;
          }
        }
      };
      new MutationObserver(scan).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      setInterval(scan, 5);
    },
    [secret, DB_NAME] as [string, string],
  );
}

const everLeaked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __leaked?: boolean }).__leaked === true);
const everReadNotes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __readNotes?: boolean }).__readNotes === true);

/**
 * Cuts the API off at the route level. The shell still comes from the live
 * server, so this is "the backend is down", which is what #61 describes — and
 * unlike setOffline it is honoured on every navigation. Returns the list of
 * API requests that actually failed, so tests can assert the precondition
 * rather than assuming it.
 */
async function cutApi(context: BrowserContext, page: Page): Promise<string[]> {
  const failed: string[] = [];
  page.on('requestfailed', (r) => {
    if (r.url().includes('/api/')) failed.push(new URL(r.url()).pathname);
  });
  await context.route('**/api/**', (route) => route.abort());
  return failed;
}

/** Captures user A's profile: a note cached offline, plus the marker and
 * unlock record that a closed browser leaves beside it. */
async function captureProfileOfA(
  context: BrowserContext,
  page: Page,
  title: string,
  body: string,
): Promise<{ profile: Profile; noteId: number }> {
  await login(page);

  const created = await context.request.post('/api/notes', { data: { title, body } });
  expect(created.ok()).toBeTruthy();
  const noteId = ((await created.json()) as { id: number }).id;

  await waitForOfflineReadiness(page);
  await page.reload();
  await expect(page.getByText(title).first()).toBeVisible();

  // Wait for THIS note: the suite shares one SQLite database, so a plain
  // count is satisfied by earlier tests' notes while ours is still caching.
  await expect
    .poll(async () => JSON.stringify((await dumpProfile(page)).notes).includes(title), {
      message: 'A’s note should be cached offline while they are logged in',
      timeout: 15_000,
    })
    .toBe(true);

  const profile = await dumpProfile(page);
  expect(profile.owner).not.toBeNull();
  expect(profile.marker, 'the identity marker survives alongside the store').not.toBeNull();
  expect(profile.unlock, 'login should have recorded unlock material').not.toBeNull();
  return { profile, noteId };
}

test.describe('Shared browser: cached notes need the password, not just a matching owner id', () => {
  test('the next arrival is stopped, and only the password lets the cache open', async ({ browser }) => {
    // Titles are unique per attempt: the suite shares one SQLite DB, so a CI
    // retry would otherwise see duplicate rows from the failed attempt.
    const runTag = Date.now().toString(36);
    const TITLE = `Shared Browser Secret ${runTag}`;

    // ── User A works, then walks away without logging out ────────────────
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const { profile, noteId } = await captureProfileOfA(contextA, pageA, TITLE, `Body of ${TITLE}`);
    await contextA.close();

    // ── The next person, on the browser A left behind ────────────────────
    // Service workers off so the API cut below is honoured on every
    // navigation; the live server still serves the shell.
    const contextB = await browser.newContext({ serviceWorkers: 'block' });
    const pageB = await contextB.newPage();
    await watchForLeak(pageB, TITLE);

    await pageB.goto('/login');
    await expect(pageB.getByRole('button', { name: /log in/i })).toBeVisible();

    // The WHOLE profile carries over — store, identity marker and unlock
    // record — because that is what surviving a browser close means.
    await seedProfile(pageB, profile);
    expect((await dumpProfile(pageB)).notes.length).toBeGreaterThan(0);
    expect(await pageB.evaluate((k) => localStorage.getItem(k), MARKER_KEY)).not.toBeNull();
    expect((await contextB.cookies()).length, 'no session cookie survives').toBe(0);

    const failedApi = await cutApi(contextB, pageB);

    // The notes list: locked, nothing read, nothing rendered.
    //
    // The leak assertions come FIRST and are not gated behind the unlock
    // screen appearing. Against a leaking build the UI assertion fails with
    // "element(s) not found" and the latches are never evaluated, so a real
    // leak would be reported as a missing element.
    await pageB.goto('/');
    await pageB.waitForTimeout(3000);
    expect(await everLeaked(pageB), 'A’s note must never reach the DOM').toBe(false);
    expect(await everReadNotes(pageB), 'A’s cached rows must not even be read').toBe(false);
    expect(failedApi, 'the offline path must really have been taken').toContain('/api/auth/me');
    await expect(pageB.getByText(TITLE)).toHaveCount(0);
    await expect(pageB.getByLabel(/^password for this account/i)).toBeVisible({ timeout: 15_000 });

    // A guarded list is worthless if note ids can be typed in directly.
    await pageB.goto(`/notes/${noteId}`);
    await pageB.waitForTimeout(3000);
    expect(await everLeaked(pageB), 'A’s note body must not open by id either').toBe(false);
    expect(await everReadNotes(pageB), 'the note route must not read the cached row').toBe(false);
    await expect(pageB.getByLabel(/^password for this account/i)).toBeVisible({ timeout: 15_000 });

    // A wrong password changes nothing.
    await pageB.goto('/');
    await expect(pageB.getByLabel(/^password for this account/i)).toBeVisible({ timeout: 15_000 });
    await pageB.getByLabel(/^password for this account/i).fill('not-the-password');
    await pageB.getByRole('button', { name: /^unlock/i }).click();
    await expect(pageB.getByRole('alert')).toContainText(/incorrect|too many/i);
    expect(await everLeaked(pageB)).toBe(false);
    expect(await everReadNotes(pageB)).toBe(false);

    // ── The legitimate owner, same browser, still no server ──────────────
    await pageB.getByLabel(/^password for this account/i).fill(PASSWORD);
    await pageB.getByRole('button', { name: /^unlock/i }).click();
    await expect(pageB.getByText(TITLE).first()).toBeVisible({ timeout: 20_000 });

    // ── Online, nobody is ever asked to unlock ───────────────────────────
    await contextB.unroute('**/api/**');
    await pageB.goto('/login');
    await login(pageB);
    await expect(pageB.getByText(TITLE).first()).toBeVisible();
    await expect(pageB.getByLabel(/^password for this account/i)).toHaveCount(0);

    await contextB.close();
  });

  /**
   * Issue #108: the same leak, one layer down. The service worker caches
   * `/api/images/*` cache-first and that cache is cleared only on a
   * deliberate logout, so a known image URL used to return the previous
   * user's note image with no session and no unlock.
   *
   * The image seeded here has an id the server does not serve, which is what
   * makes both halves conclusive: bytes coming back can only have come from
   * the cache. That is also why the backend is not cut off as it is above —
   * an unauthenticated request is already refused by the server, so the only
   * thing that can hand out A's image is the service worker.
   */
  test('a cached note image is not served without a session, and comes back after login', async ({
    browser,
  }) => {
    const runTag = Date.now().toString(36);
    const TITLE = `Image Owner ${runTag}`;
    // An id the API will never serve, so the only source of these bytes is
    // the SW cache.
    const IMAGE_URL = '/api/images/98765432';
    const SECRET_BYTES = `A-private-image-${runTag}`;

    // ── User A views a note with an image, then walks away ────────────────
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const { profile } = await captureProfileOfA(contextA, pageA, TITLE, `Body of ${TITLE}`);
    const cacheName = await pageA.evaluate(
      async ([url, bytes]) => {
        const name = (await caches.keys()).find((k) => k.startsWith('crapnote-'));
        if (!name) throw new Error('the service worker cache should exist by now');
        const cache = await caches.open(name);
        await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
        return name;
      },
      [IMAGE_URL, SECRET_BYTES] as const,
    );
    await contextA.close();

    // ── The next person, on the browser A left behind ─────────────────────
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto('/login');
    await expect(pageB.getByRole('button', { name: /log in/i })).toBeVisible();
    await seedProfile(pageB, profile);
    await pageB.evaluate(
      async ([name, url, bytes]) => {
        const cache = await caches.open(name);
        await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
      },
      [cacheName, IMAGE_URL, SECRET_BYTES] as const,
    );
    // The leak needs the SW to be answering fetches, so wait for it to claim
    // this page rather than assuming it has.
    await pageB.evaluate(() => navigator.serviceWorker.ready);
    await pageB.waitForFunction(() => navigator.serviceWorker.controller !== null);
    expect((await contextB.cookies()).length, 'no session cookie survives').toBe(0);

    const beforeLogin = await pageB.evaluate(async (url) => {
      const res = await fetch(url);
      return { status: res.status, body: await res.text() };
    }, IMAGE_URL);
    expect(beforeLogin.body, "A's cached image must not be served to whoever arrives next").not.toContain(
      SECRET_BYTES,
    );
    expect(beforeLogin.status).not.toBe(200);

    // ── A comes back and signs in: their own cache is theirs again ────────
    await login(pageB);
    await expect
      .poll(() => pageB.evaluate(async (url) => (await fetch(url)).text(), IMAGE_URL), {
        message: 'the owner’s cached image should render again once unlocked',
        timeout: 15_000,
      })
      .toContain(SECRET_BYTES);

    // And it really did come from the cache — the API has no such image.
    const fromServer = await contextB.request.get(IMAGE_URL);
    expect(fromServer.status()).not.toBe(200);

    await contextB.close();
  });

  test('an install with cached notes but no unlock material fails closed', async ({ browser }) => {
    const runTag = Date.now().toString(36);
    const TITLE = `Pre-Upgrade Secret ${runTag}`;

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const { profile } = await captureProfileOfA(contextA, pageA, TITLE, `Body of ${TITLE}`);
    await contextA.close();

    const contextB = await browser.newContext({ serviceWorkers: 'block' });
    const pageB = await contextB.newPage();
    await watchForLeak(pageB, TITLE);
    await pageB.goto('/login');
    await expect(pageB.getByRole('button', { name: /log in/i })).toBeVisible();

    // Store and marker, but no unlock record — a browser that last logged in
    // before this shipped. There is no way to prove ownership, so the only
    // safe answer is to not restore the identity at all.
    await seedProfile(pageB, profile, false);
    const failedApi = await cutApi(contextB, pageB);

    await pageB.goto('/');
    await pageB.waitForTimeout(3000);
    expect(await everLeaked(pageB), 'no cached content without proof of ownership').toBe(false);
    expect(await everReadNotes(pageB)).toBe(false);
    expect(failedApi).toContain('/api/auth/me');
    await expect(pageB).toHaveURL(/\/login/, { timeout: 15_000 });

    await contextB.close();
  });
});
