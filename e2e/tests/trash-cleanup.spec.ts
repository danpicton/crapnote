import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

async function createTrashedNote(page: Page, title: string): Promise<number> {
  const created = await page.request.post('/api/notes', { data: { title, body: '' } });
  expect(created.ok()).toBe(true);
  const note = await created.json() as { id: number };
  const deleted = await page.request.delete(`/api/notes/${note.id}`);
  expect(deleted.status()).toBe(204);
  return note.id;
}

async function returnToNotes(page: Page) {
  await page.getByRole('link', { name: 'Back to notes' }).filter({ visible: true }).click();
  await expect(page).toHaveURL('/');
}

test.describe('Trash cleanup visibility', () => {
  // Route interception must see the list request rather than letting an
  // installed service worker own it.
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('cleanup completed before re-entering Deleted is reflected immediately', async ({ page }) => {
    const title = 'Purged before Deleted opens';
    const noteID = await createTrashedNote(page, title);
    await page.goto('/trash');
    await expect(page.locator('li.entry').filter({ hasText: title })).toBeVisible();
    await returnToNotes(page);

    // Model a scheduler run that completed while Deleted was closed. The next
    // list response is authoritative even though this page showed the entry on
    // its previous visit.
    await page.route('**/api/trash?**', (route) => route.fulfill({ json: [] }));
    await page.getByTitle('Trash', { exact: true }).click();

    await expect(page).toHaveURL('/trash');
    await expect(page.locator('li.entry').filter({ hasText: title })).toHaveCount(0);
    await expect(page.getByText(/trash is empty/i)).toBeVisible();

    await page.unroute('**/api/trash?**');
    expect((await page.request.delete(`/api/trash/${noteID}`)).status()).toBe(204);
  });

  test('refreshing Deleted after cleanup removes an entry from the open view', async ({ page }) => {
    const title = 'Purged while Deleted is open';
    const noteID = await createTrashedNote(page, title);
    await page.goto('/trash');
    const entry = page.locator('li.entry').filter({ hasText: title });
    await expect(entry).toBeVisible();

    // The already-rendered view remains unchanged until its documented manual
    // refresh; that refresh must fetch the post-cleanup list.
    await page.route('**/api/trash?**', (route) => route.fulfill({ json: [] }));
    await expect(entry).toBeVisible();
    await page.reload();

    await expect(entry).toHaveCount(0);
    await expect(page.getByText(/trash is empty/i)).toBeVisible();

    await page.unroute('**/api/trash?**');
    expect((await page.request.delete(`/api/trash/${noteID}`)).status()).toBe(204);
  });
});
