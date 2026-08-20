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

/** Counts notes in the offline IndexedDB store (0 if missing). */
async function offlineNoteCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('crapnote-notes-v2');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('notes')) {
            db.close();
            resolve(0);
            return;
          }
          const count = db.transaction('notes', 'readonly').objectStore('notes').count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => {
            db.close();
            resolve(0);
          };
        };
        req.onerror = () => resolve(0);
      }),
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
    const keep = await mkNote('Offline Keeper');
    await mkNote('Offline Delete Target');
    await mkNote('Offline Archive Target');

    // Let the SW install, then reload so the page is SW-controlled and the
    // list load populates the offline IndexedDB cache.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByText('Offline Keeper').first()).toBeVisible();
    await expect
      .poll(() => offlineNoteCount(page), { message: 'offline cache should hold the seeded notes' })
      .toBeGreaterThanOrEqual(3);

    // ── Airplane mode ────────────────────────────────────────────────────
    await context.setOffline(true);

    // Cold start: the SW serves the cached shell, the list paints from IDB.
    await page.reload();
    await expect(page.getByText('Offline Keeper').first()).toBeVisible();
    await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();

    // A note never opened online still opens offline via its own route.
    await page.goto(`/notes/${keep.id}`);
    await expect(page.getByText('Body of Offline Keeper')).toBeVisible();

    // An unvisited page still opens offline.
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible();

    // ── Offline delete ───────────────────────────────────────────────────
    await page.goto('/');
    const delRow = page
      .locator('.note-item')
      .filter({ hasText: 'Offline Delete Target' })
      .first();
    await delRow.hover();
    await delRow.locator('[title="Delete"]').click();
    await expect(page.getByText('Offline Delete Target')).toHaveCount(0);

    // ── Offline archive ──────────────────────────────────────────────────
    const arcRow = page
      .locator('.note-item')
      .filter({ hasText: 'Offline Archive Target' })
      .first();
    await arcRow.hover();
    await arcRow.getByRole('button', { name: /move to archive/i }).click();
    await expect(page.getByText('Offline Archive Target')).toHaveCount(0);

    // Both survive a reload while still offline (they're queued in IDB, not
    // just hidden in memory).
    await page.reload();
    await expect(page.getByText('Offline Keeper').first()).toBeVisible();
    await expect(page.getByText('Offline Delete Target')).toHaveCount(0);
    await expect(page.getByText('Offline Archive Target')).toHaveCount(0);

    // ── Reconnect: queued actions replay against the server ──────────────
    await context.setOffline(false);

    await expect
      .poll(
        async () => {
          const res = await api.get('/api/notes?limit=100');
          if (!res.ok()) return 'list-failed';
          const titles = ((await res.json()) as Array<{ title: string }>).map((n) => n.title);
          return {
            deleted: !titles.includes('Offline Delete Target'),
            archivedGone: !titles.includes('Offline Archive Target'),
          };
        },
        { message: 'offline delete + archive should replay to the server on reconnect', timeout: 15_000 },
      )
      .toEqual({ deleted: true, archivedGone: true });

    const archived = await api.get('/api/archive?limit=100');
    expect(archived.ok()).toBeTruthy();
    const archivedTitles = ((await archived.json()) as Array<{ title: string }>).map((n) => n.title);
    expect(archivedTitles).toContain('Offline Archive Target');
  });
});
