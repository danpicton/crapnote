import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** Reads the local authenticated footprint: cached /api responses in Cache
 * Storage and the number of notes in the offline IndexedDB store. */
async function localFootprint(page: Page) {
  return page.evaluate(async () => {
    let cachedApiEntries = 0;
    const cacheKeys = await caches.keys();
    for (const key of cacheKeys) {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      cachedApiEntries += requests.filter((r) => new URL(r.url).pathname.startsWith('/api/')).length;
    }

    // Count notes in the offline DB, treating a missing DB/store as zero.
    const offlineNotes = await new Promise<number>((resolve) => {
      const dbs = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
      dbs
        .then((list) => {
          if (!list.some((d) => d.name === 'crapnote-notes-v2')) {
            resolve(0);
            return;
          }
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
        })
        .catch(() => resolve(0));
    });

    return { cachedApiEntries, offlineNotes };
  });
}

test.describe('Offline data is cleared at logout', () => {
  test('cached API responses and the offline note store do not survive logout', async ({ page }) => {
    await login(page);

    // Create a note so there is something to cache offline.
    await page.getByLabel('New note').click();
    const titleInput = page.getByPlaceholder(/note title/i);
    const saved = page.waitForResponse(
      (r) => r.url().includes('/api/notes') && r.request().method() === 'PUT',
    );
    await titleInput.fill('Private note');
    await saved;

    // Wait for the service worker to control the page, then reload so the
    // /api fetches flow through it and get cached, and the notes list load
    // populates the offline IndexedDB store.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByText('Private note').first()).toBeVisible();

    await expect
      .poll(async () => (await localFootprint(page)).offlineNotes, {
        message: 'offline store should be populated while logged in',
      })
      .toBeGreaterThan(0);

    // Log out and verify nothing authenticated is left behind.
    await page.getByRole('button', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await expect
      .poll(async () => localFootprint(page), {
        message: 'cached /api responses and offline notes should be wiped at logout',
      })
      .toEqual({ cachedApiEntries: 0, offlineNotes: 0 });
  });
});
