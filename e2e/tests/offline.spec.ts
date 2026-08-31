import { test, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Offline-first behaviour: cold start in airplane mode must render cached
 * notes instantly, unvisited routes and notes must still open, and deletes/
 * archives made offline must apply optimistically and replay against the
 * server on reconnect.
 */

/**
 * Cut the network deterministically.
 *
 * `context.setOffline(true)` alone is not enough: it flips `navigator.onLine`
 * and blocks the page's own requests, but a service-worker-initiated `fetch`
 * still reaches the local server after a subsequent navigation. That made
 * `/api/auth/me` return a real 200 offline, which silently changed what these
 * tests exercised — locally the app never took its offline path at all, while
 * CI (different timing) did. Aborting `/api/**` at the route level is
 * honoured for the service worker's fetches too, so the SW falls back to its
 * marked 503 exactly as it would with the backend down. Service workers stay
 * ENABLED: these tests are about the SW serving the cached shell.
 */
async function goOffline(context: BrowserContext, page: Page) {
  await context.route('**/api/**', (route) => route.abort());
  await context.setOffline(true);
  // Prove the app really is taking the offline path rather than trusting the
  // emulation: the SW must answer /api/auth/me with its offline marker.
  const seen = await page.evaluate(async () => {
    try {
      const res = await fetch('/api/auth/me');
      return { status: res.status, marker: res.headers.get('X-Crapnote-Offline') };
    } catch {
      return { status: 0, marker: 'network-failure' };
    }
  });
  expect(seen.marker, `expected an offline /api/auth/me, got ${JSON.stringify(seen)}`).not.toBeNull();
}

async function goOnline(context: BrowserContext) {
  await context.unroute('**/api/**');
  await context.setOffline(false);
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** True when every given note id is present in the offline IndexedDB store. */
async function offlineHasNotes(page: Page, ids: number[]): Promise<boolean> {
  return page.evaluate(
    (wanted) =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('crapnote-notes-v2');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('notes')) {
            db.close();
            resolve(false);
            return;
          }
          const all = db.transaction('notes', 'readonly').objectStore('notes').getAllKeys();
          all.onsuccess = () => {
            db.close();
            const keys = all.result as number[];
            resolve(wanted.every((id) => keys.includes(id)));
          };
          all.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        req.onerror = () => resolve(false);
      }),
    ids,
  );
}

test.describe('Offline mode', () => {
  test.afterEach(async ({ context }) => {
    // Never leak airplane mode into the next test.
    await goOnline(context);
  });

  test('cold offline start: cached list renders, unvisited routes open, offline delete/archive replay on reconnect', async ({
    page,
    context,
  }) => {
    await login(page);

    // Seed three notes through the API (session cookie is shared with the
    // browser context). None of them is ever opened individually online.
    const api = context.request;
    const mkNote = async (title: string) => {
      const res = await api.post('/api/notes', { data: { title, body: `Body of ${title}` } });
      expect(res.ok()).toBeTruthy();
      return (await res.json()) as { id: number };
    };
    // Titles are unique per attempt: the suite shares one SQLite DB, so a CI
    // retry would otherwise see duplicate rows from the failed attempt.
    const runTag = Date.now().toString(36);
    const KEEP = `Offline Keeper ${runTag}`;
    const DEL = `Offline Delete Target ${runTag}`;
    const ARC = `Offline Archive Target ${runTag}`;
    const keep = await mkNote(KEEP);
    const del = await mkNote(DEL);
    const arc = await mkNote(ARC);

    // Let the SW install and take control, then reload so the page is
    // SW-controlled and the list load populates the offline IndexedDB cache.
    // Explicitly wait for the cached app shell too — serviceWorker.ready can
    // resolve before clients.claim()/shell-priming have finished on a slow
    // CI runner, and an offline reload without the cached shell boots nothing.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.waitForFunction(() => caches.match('/').then((res) => !!res));
    await page.reload();
    await expect(page.getByText(KEEP).first()).toBeVisible();
    // Wait for the three seeded notes SPECIFICALLY: a raw count can be
    // satisfied by other tests' notes while ours are still mid-caching, and
    // the upcoming reload would kill the caching loop before they land.
    await expect
      .poll(() => offlineHasNotes(page, [keep.id, del.id, arc.id]), {
        message: 'offline cache should hold the three seeded notes',
        timeout: 15_000,
      })
      .toBe(true);

    // ── Airplane mode ────────────────────────────────────────────────────
    await goOffline(context, page);

    // Cold start: the SW serves the cached shell, the list paints from IDB.
    await page.reload();
    await expect(page.getByText(KEEP).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();

    // A note never opened online still opens offline via its own route.
    await page.goto(`/notes/${keep.id}`);
    await expect(page.getByText(`Body of ${KEEP}`)).toBeVisible();

    // An unvisited page still opens offline.
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible();

    // ── Offline delete ───────────────────────────────────────────────────
    await page.goto('/');
    const delRow = page.locator('.note-item').filter({ hasText: DEL }).first();
    await delRow.hover();
    await delRow.locator('[title="Delete"]').click();
    await expect(page.getByText(DEL)).toHaveCount(0);

    // ── Offline archive ──────────────────────────────────────────────────
    const arcRow = page.locator('.note-item').filter({ hasText: ARC }).first();
    await arcRow.hover();
    await arcRow.getByRole('button', { name: /move to archive/i }).click();
    await expect(page.getByText(ARC)).toHaveCount(0);

    // Both survive a reload while still offline (they're queued in IDB, not
    // just hidden in memory).
    await page.reload();
    await expect(page.getByText(KEEP).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(DEL)).toHaveCount(0);
    await expect(page.getByText(ARC)).toHaveCount(0);

    // ── Reconnect: queued actions replay against the server ──────────────
    await goOnline(context);

    await expect
      .poll(
        async () => {
          const res = await api.get('/api/notes?limit=100');
          if (!res.ok()) return 'list-failed';
          const titles = ((await res.json()) as Array<{ title: string }>).map((n) => n.title);
          return {
            deleted: !titles.includes(DEL),
            archivedGone: !titles.includes(ARC),
          };
        },
        { message: 'offline delete + archive should replay to the server on reconnect', timeout: 15_000 },
      )
      .toEqual({ deleted: true, archivedGone: true });

    const archived = await api.get('/api/archive?limit=100');
    expect(archived.ok()).toBeTruthy();
    const archivedTitles = ((await archived.json()) as Array<{ title: string }>).map((n) => n.title);
    expect(archivedTitles).toContain(ARC);
  });
});

test.describe('Offline immediately after login (no reload, no prior clicks)', () => {
  test.afterEach(async ({ context }) => {
    await goOnline(context);
  });

  // The user's reported failure mode: log in, touch nothing, cut the
  // network — then every click 500'd because each screen's JS chunk was
  // lazy-loaded on first visit. Route code is now pre-imported at startup,
  // so navigation must work from the module registry alone, without a
  // reload and without depending on service-worker state.
  test('every screen still opens after cutting the network right after login', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // phone layout
    await login(page);

    // Wait for the startup pre-import pass to complete (flag set by the
    // root layout once all preloadCode calls succeed).
    await page.waitForFunction(
      () => (window as Window & { __crapnoteRoutesPreloaded?: boolean }).__crapnoteRoutesPreloaded === true,
    );

    // Airplane mode. Deliberately NO reload and NO prior navigation.
    await goOffline(context, page);

    // New note → /notes/[tempId] — the editor screen carries the heaviest
    // chunk graph (Milkdown). It was never visited online.
    await page.locator('.mob-new-btn').click();
    await expect(page).toHaveURL(/\/notes\/-\d+/);
    await expect(page.getByPlaceholder(/note title/i)).toBeVisible({ timeout: 15_000 });

    // Back to the list, then screens never opened online: Settings, Archive.
    await page.locator('a.mob-topbar-btn').click();
    const tabs = page.getByRole('navigation', { name: /main navigation/i });
    await tabs.getByRole('link', { name: /settings/i }).click();
    await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible();

    await tabs.getByRole('link', { name: /notes/i }).click();
    await tabs.getByRole('link', { name: /archive/i }).click();
    // The Archive SCREEN must render (no SvelteKit 500 page). Its data path
    // is covered by the cold-start spec above; what matters here is that the
    // route's chunk was already in the module registry.
    await expect(page).toHaveURL(/\/archive$/);
    await expect(page.locator('.mob-wordmark, .page-title').first()).toBeVisible();
  });
});

test.describe('Offline edit and lock-toggle replay', () => {
  test.afterEach(async ({ context }) => {
    await goOnline(context);
  });

  // Together with the delete/archive spec above, this gives every sync verb
  // (create, edit, delete, archive, flag toggle) an end-to-end regression
  // test — a future change that silently breaks replay fails here in CI.
  test('an offline title edit and an offline unlock both reach the server on reconnect', async ({
    page,
    context,
  }) => {
    // Reconnect sync is driven by the window 'online' event AND a 30s
    // heartbeat; Playwright's emulation doesn't reliably deliver the event,
    // so allow a full heartbeat interval before judging the replay.
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 }); // phone layout
    await login(page);

    const api = context.request;
    const runTag = Date.now().toString(36);
    const EDIT = `Offline Edit Target ${runTag}`;
    const EDITED = `Edited Offline ${runTag}`;
    const LOCKED = `Offline Unlock Target ${runTag}`;

    const mkNote = async (title: string) => {
      const res = await api.post('/api/notes', { data: { title, body: `Body of ${title}` } });
      expect(res.ok()).toBeTruthy();
      return (await res.json()) as { id: number };
    };
    const editNote = await mkNote(EDIT);
    const lockedNote = await mkNote(LOCKED);
    const lockRes = await api.patch(`/api/notes/${lockedNote.id}/lock`);
    expect(lockRes.ok()).toBeTruthy();

    // SW controlled + shell cached + both notes mirrored into IndexedDB.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.waitForFunction(() => caches.match('/').then((res) => !!res));
    await page.reload();
    await expect
      .poll(() => offlineHasNotes(page, [editNote.id, lockedNote.id]), {
        message: 'offline cache should hold both seeded notes',
        timeout: 15_000,
      })
      .toBe(true);

    // ── Airplane mode ────────────────────────────────────────────────────
    await goOffline(context, page);
    await page.reload();

    // Unlock the locked note offline AND edit it in the same breath — the
    // reported wedge: the content PUT used to replay before the unlock,
    // bounce off the still-locked note with a 423 forever, and the status
    // stuck on NOT SYNCED.
    const UNLOCKED_EDIT = `Unlocked And Edited ${runTag}`;
    await page.locator('.note-item').filter({ hasText: LOCKED }).first().click();
    await page.locator(`.mob-topbar button[aria-label="Unlock note"]`).click();
    await expect(page.locator(`.mob-topbar button[aria-label="Lock note"]`)).toBeVisible();
    const lockedTitle = page.getByPlaceholder('Note title').first();
    await expect(lockedTitle).toHaveValue(LOCKED);
    await lockedTitle.fill(UNLOCKED_EDIT);
    await lockedTitle.blur();
    await page.waitForTimeout(1200); // let the debounced offline save land
    await page.locator('a.mob-topbar-btn').click(); // back to list

    // Edit the other note's title offline.
    await page.locator('.note-item').filter({ hasText: EDIT }).first().click();
    const title = page.getByPlaceholder('Note title').first();
    await expect(title).toHaveValue(EDIT);
    await title.fill(EDITED);
    await title.blur();
    // Wait for the debounced autosave to land in IndexedDB.
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              new Promise<string>((resolve) => {
                const req = indexedDB.open('crapnote-notes-v2');
                req.onsuccess = () => {
                  const db = req.result;
                  const get = db.transaction('notes', 'readonly').objectStore('notes').get(id);
                  get.onsuccess = () => {
                    db.close();
                    resolve((get.result as { title?: string } | undefined)?.title ?? '');
                  };
                  get.onerror = () => {
                    db.close();
                    resolve('');
                  };
                };
                req.onerror = () => resolve('');
              }),
            editNote.id,
          ),
        { message: 'offline edit should be persisted to IndexedDB', timeout: 15_000 },
      )
      .toBe(EDITED);
    await page.locator('a.mob-topbar-btn').click(); // back to list (sync page)

    // ── Reconnect: both the edit and the unlock replay ───────────────────
    await goOnline(context);

    await expect
      .poll(
        async () => {
          const [editRes, lockCheck] = await Promise.all([
            api.get(`/api/notes/${editNote.id}`),
            api.get(`/api/notes/${lockedNote.id}`),
          ]);
          if (!editRes.ok() || !lockCheck.ok()) return 'fetch-failed';
          const editServer = (await editRes.json()) as { title: string };
          const lockServer = (await lockCheck.json()) as { title: string; locked: boolean };
          return { title: editServer.title, lockedTitle: lockServer.title, locked: lockServer.locked };
        },
        { message: 'offline edit + unlock-and-edit should replay to the server', timeout: 60_000 },
      )
      .toEqual({ title: EDITED, lockedTitle: UNLOCKED_EDIT, locked: false });

    // And the status must come back to SYNCED — a wedged replay leaves it
    // stuck on NOT SYNCED forever.
    await expect(page.locator('.mob-sync-row')).toContainText('SYNCED', { timeout: 45_000 });
    await expect(page.locator('.mob-sync-row')).not.toContainText('NOT SYNCED');
  });
});


/**
 * The other kind of cold start: not a reload, but the app opened afresh with
 * no network at all — a closed-and-reopened PWA. sessionStorage is gone, so
 * nothing in this browsing session has proved who is at the keyboard, and the
 * unlock screen stands between the browser and the cached notes (issue #61).
 * That is the real user journey now, so the spec performs the unlock.
 */
test.describe('Offline cold start in a fresh browsing session', () => {
  test('asks for the password once, then opens the cached notes', async ({ browser }) => {
    const runTag = Date.now().toString(36);
    const TITLE = `Cold Start Note ${runTag}`;

    // Session one: log in, get the note cached and the SW primed.
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    const created = await context.request.post('/api/notes', {
      data: { title: TITLE, body: `Body of ${TITLE}` },
    });
    expect(created.ok()).toBeTruthy();
    const noteId = ((await created.json()) as { id: number }).id;

    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.waitForFunction(() => caches.match('/').then((res) => !!res));
    await page.reload();
    await expect(page.getByText(TITLE).first()).toBeVisible();
    await expect.poll(() => offlineHasNotes(page, [noteId]), { timeout: 15_000 }).toBe(true);

    // A reload inside the SAME browsing session is not a fresh start, so it
    // must NOT re-prompt — that is the offline-first promise.
    await goOffline(context, page);
    await page.reload();
    await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/^password for this account/i)).toHaveCount(0);

    // Now close the browsing session. Everything on disk survives; only
    // sessionStorage goes — which is exactly what closing a browser does.
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();

    // Cold start: locked, and nothing cached is shown.
    await expect(page.getByLabel(/^password for this account/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(TITLE)).toHaveCount(0);

    // The owner unlocks and gets their notes, still with no network.
    await page.getByLabel(/^password for this account/i).fill('admin123');
    await page.getByRole('button', { name: /^unlock/i }).click();
    await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 20_000 });

    // And the unlock holds for the rest of this browsing session.
    await page.reload();
    await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/^password for this account/i)).toHaveCount(0);

    await goOnline(context);
    await context.close();
  });
});
