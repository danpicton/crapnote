import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** Create notes straight through the API and pin each one, oldest first. */
async function seedPinned(page: Page, titles: string[]) {
  await page.evaluate(async (ts) => {
    for (const t of ts) {
      const res = await fetch('/api/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t, body: '' }),
      });
      const { id } = await res.json();
      await fetch(`/api/notes/${id}/pin`, { method: 'PATCH', credentials: 'include' });
    }
  }, titles);
}

const pinnedTitles = (page: Page) =>
  page.locator('li.note-item.pinned .note-title').allInnerTexts();

test.describe('Pinned note reordering', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dragging a pinned note persists its new position', async ({ page }) => {
    await seedPinned(page, ['Pin Alpha', 'Pin Bravo', 'Pin Charlie']);
    await page.reload();
    await page.waitForSelector('li.note-item.pinned');

    // Pinning puts the newest at the top.
    await expect
      .poll(() => pinnedTitles(page))
      .toEqual(['Pin Charlie', 'Pin Bravo', 'Pin Alpha']);

    const rows = page.locator('li.note-item.pinned');
    await rows.nth(2).hover();
    const grip = (await page.locator('.pin-drag-handle').nth(2).boundingBox())!;
    const target = (await rows.nth(0).boundingBox())!;

    const saved = page.waitForResponse(
      (r) => r.url().includes('/api/notes/pins/order') && r.request().method() === 'PUT',
    );
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 40, target.y + 2, { steps: 12 });
    // A drop indicator tracks where the row would land.
    await expect(page.locator('.pin-drop-before, .pin-drop-after')).toHaveCount(1);
    await page.mouse.up();
    await saved;

    await expect
      .poll(() => pinnedTitles(page))
      .toEqual(['Pin Alpha', 'Pin Charlie', 'Pin Bravo']);

    // The order must survive a reload — it lives on the server, not in the tab.
    await page.reload();
    await page.waitForSelector('li.note-item.pinned');
    await expect
      .poll(() => pinnedTitles(page))
      .toEqual(['Pin Alpha', 'Pin Charlie', 'Pin Bravo']);
  });

  test('unpinned notes have no drag handle', async ({ page }) => {
    await page.evaluate(async () => {
      await fetch('/api/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Just Plain', body: '' }),
      });
    });
    await page.reload();

    const row = page.locator('li.note-item').filter({ hasText: 'Just Plain' });
    await expect(row).toHaveCount(1);
    await row.hover();
    await expect(row.locator('.pin-drag-handle')).toHaveCount(0);
  });
});
