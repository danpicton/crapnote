import { test, expect, type Page } from '@playwright/test';

/**
 * The offline note store outlives a session: `clearLocalData()` runs on an
 * explicit logout and on nothing else. So a browser that was merely closed —
 * a crash, someone walking away from a shared machine — still holds the last
 * user's note titles and bodies on disk.
 *
 * Before issue #61 the notes route read that store on mount, with no auth or
 * ownership check and before the layout's redirect to /login could win. With
 * the server unreachable the next person got the whole cached list for free.
 *
 * This spec reproduces exactly that: user A's offline store is present, the
 * session and the remembered identity are not, and the network is down. It
 * then logs A back in and confirms the gate opens again, so the fix cannot
 * pass by simply breaking offline mode.
 *
 * (A client-side gate stops the casual next user, not someone with DevTools —
 * the rows are still on disk until logout. Encryption at rest is out of scope,
 * per #56 and #61.)
 */

const DB_NAME = 'crapnote-notes-v2';
const DB_VERSION = 2;

type Snapshot = { notes: unknown[]; owner: number | null };

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** Waits until the SW controls the page and the app shell is cached, so an
 * offline navigation actually boots something. */
async function waitForOfflineReadiness(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(() => caches.match('/').then((res) => !!res));
}

/** Copies the offline store out of a browser context: cached rows plus the
 * owner id stamped on them. */
function dumpOfflineStore(page: Page): Promise<Snapshot> {
  return page.evaluate(
    ([name]) =>
      new Promise<Snapshot>((resolve) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['notes', 'meta'], 'readonly');
          const notesReq = tx.objectStore('notes').getAll();
          const ownerReq = tx.objectStore('meta').get('owner');
          tx.oncomplete = () => {
            db.close();
            const row = ownerReq.result as { userId: number } | undefined;
            resolve({ notes: notesReq.result as unknown[], owner: row?.userId ?? null });
          };
        };
        req.onerror = () => resolve({ notes: [], owner: null });
      }),
    [DB_NAME] as const,
  );
}

/** Writes a captured store into the current context — "this browser profile
 * still holds the previous user's cached notes". */
function seedOfflineStore(page: Page, snapshot: Snapshot): Promise<void> {
  return page.evaluate(
    ([name, version, snap]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name as string, version as number);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const data = snap as Snapshot;
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
    [DB_NAME, DB_VERSION, snapshot] as const,
  );
}

/**
 * Installs a leak detector that runs before any app script on every
 * navigation. A steady-state assertion would miss a single frame of user A's
 * titles painted before the guard cleared them, and a flash is still a leak —
 * so this samples the DOM (text nodes and input values) continuously and
 * latches the first sighting.
 */
async function watchForLeak(page: Page, secret: string) {
  await page.addInitScript(
    ([needle, dbName]: [string, string]) => {
      const w = window as unknown as { __leaked?: boolean; __readNotes?: boolean };
      w.__leaked = false;

      // The DOM check alone is a race: the layout's redirect to /login can
      // beat the IndexedDB read and hide a guard that isn't there. Latching
      // every transaction over the notes store makes "the cached rows were
      // never even fetched" a deterministic assertion. Reading the OWNER (a
      // meta-store transaction) is exactly what the guard is supposed to do,
      // so it is deliberately not latched.
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

/** True if the app opened a transaction over the cached notes store. */
const everReadNotes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __readNotes?: boolean }).__readNotes === true);

test.describe('Shared browser: cached notes are gated on ownership', () => {
  test('a new arrival sees nothing of the previous user, who still gets their cache back', async ({
    browser,
  }) => {
    // Titles are unique per attempt: the suite shares one SQLite DB, so a CI
    // retry would otherwise see duplicate rows from the failed attempt.
    const runTag = Date.now().toString(36);
    const TITLE = `Shared Browser Secret ${runTag}`;
    const BODY = `Body of ${TITLE}`;

    // ── User A works, then walks away without logging out ────────────────
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await login(pageA);

    const created = await contextA.request.post('/api/notes', { data: { title: TITLE, body: BODY } });
    expect(created.ok()).toBeTruthy();
    const noteId = ((await created.json()) as { id: number }).id;

    await waitForOfflineReadiness(pageA);
    await pageA.reload();
    await expect(pageA.getByText(TITLE).first()).toBeVisible();

    // Wait for THIS note specifically: the suite shares one SQLite database,
    // so a plain count is satisfied by earlier tests' notes while ours is
    // still mid-caching, and the snapshot would carry no secret to leak.
    await expect
      .poll(async () => JSON.stringify((await dumpOfflineStore(pageA)).notes).includes(TITLE), {
        message: 'A’s note should be cached offline while they are logged in',
        timeout: 15_000,
      })
      .toBe(true);

    const snapshot = await dumpOfflineStore(pageA);
    expect(snapshot.owner).not.toBeNull();
    expect(JSON.stringify(snapshot.notes)).toContain(TITLE);

    // Closing the browser. No logout, so nothing is wiped.
    await contextA.close();

    // ── The next person, on the browser A left behind ────────────────────
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await watchForLeak(pageB, TITLE);

    // Land on /login while still online so the service worker installs and
    // primes the shell — otherwise an offline navigation boots nothing and
    // the test would "pass" for the wrong reason.
    await pageB.goto('/login');
    await expect(pageB.getByRole('button', { name: /log in/i })).toBeVisible();
    await waitForOfflineReadiness(pageB);

    // The profile still holds A's offline store; no session and no remembered
    // identity go with it.
    await seedOfflineStore(pageB, snapshot);
    expect((await dumpOfflineStore(pageB)).notes.length).toBeGreaterThan(0);

    await contextB.setOffline(true);

    // The notes list: mounts, reads nothing, redirects to login.
    await pageB.goto('/');
    await expect(pageB).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(pageB.getByRole('button', { name: /log in/i })).toBeVisible();
    expect(await everLeaked(pageB), 'A’s note must never reach the DOM').toBe(false);
    expect(await everReadNotes(pageB), 'A’s cached rows must not even be read').toBe(false);
    await expect(pageB.getByText(TITLE)).toHaveCount(0);

    // A guarded list is worthless if the note ids can be typed in directly.
    await pageB.goto(`/notes/${noteId}`);
    await expect(pageB).toHaveURL(/\/login/, { timeout: 15_000 });
    expect(await everLeaked(pageB), 'A’s note body must not open by id either').toBe(false);
    expect(await everReadNotes(pageB), 'the note route must not read the cached row').toBe(false);

    // ── A comes back to the same browser: the gate opens again ───────────
    await contextB.setOffline(false);
    await login(pageB);
    await expect(pageB.getByText(TITLE).first()).toBeVisible();

    // ...and still opens with the network gone, which is the whole reason
    // the guard cannot simply be "require a live session".
    await waitForOfflineReadiness(pageB);
    await expect
      .poll(async () => JSON.stringify((await dumpOfflineStore(pageB)).notes).includes(TITLE), {
        timeout: 15_000,
      })
      .toBe(true);
    await contextB.setOffline(true);
    await pageB.reload();
    await expect(pageB.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 });

    await contextB.setOffline(false);
    await contextB.close();
  });
});
