import { test, expect, type Page } from '@playwright/test';

/**
 * Offline-first behaviour: cold start in airplane mode must render cached
 * notes instantly, unvisited routes and notes must still open, and deletes/
 * archives made offline must apply optimistically and replay against the
 * server on reconnect.
 */

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
    await context.setOffline(false);
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
    await context.setOffline(true);

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
    await context.setOffline(false);

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
    await context.setOffline(false);
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
    await context.setOffline(true);

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
    // is covered by the cold-start spec above — and under Playwright's
    // offline emulation, service-worker-initiated fetches can still reach
    // the local server, so the empty/offline notice isn't deterministic here.
    await expect(page).toHaveURL(/\/archive$/);
    await expect(page.locator('.mob-wordmark, .page-title').first()).toBeVisible();
  });
});
