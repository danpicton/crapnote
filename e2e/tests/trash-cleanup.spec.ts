import { test, expect, type Page } from '@playwright/test';
import { expireTrashEntry, startIsolatedServer, type IsolatedServer } from '../helpers/server';

async function login(page: Page, server: IsolatedServer) {
  await page.goto(`${server.baseURL}/login`);
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL(`${server.baseURL}/`);
}

async function createTrashedNote(
  page: Page,
  server: IsolatedServer,
  title: string,
): Promise<number> {
  const created = await page.request.post(`${server.baseURL}/api/notes`, {
    data: { title, body: '' },
  });
  expect(created.ok()).toBe(true);
  const note = await created.json() as { id: number };
  const deleted = await page.request.delete(`${server.baseURL}/api/notes/${note.id}`);
  expect(deleted.status()).toBe(204);
  return note.id;
}

async function waitForStartupPurge(page: Page, server: IsolatedServer, noteID: number) {
  await expect.poll(async () => {
    const response = await page.request.get(`${server.baseURL}/api/trash?limit=100&offset=0`);
    if (!response.ok()) return false;
    const entries = await response.json() as Array<{ note_id: number }>;
    return !entries.some((entry) => entry.note_id === noteID);
  }).toBe(true);

  const restore = await page.request.post(`${server.baseURL}/api/trash/${noteID}/restore`);
  expect(restore.status()).toBe(404);
}

async function returnToNotes(page: Page, server: IsolatedServer) {
  await page.getByRole('link', { name: 'Back to notes' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(`${server.baseURL}/`);
}

test.describe('Trash cleanup visibility', () => {
  test.use({ serviceWorkers: 'block' });

  test('cleanup completed before re-entering Deleted is reflected immediately', async ({ page }) => {
    const server = await startIsolatedServer();
    try {
      await login(page, server);
      const title = 'Purged before Deleted opens';
      const noteID = await createTrashedNote(page, server, title);
      await page.goto(`${server.baseURL}/trash`);
      await expect(page.locator('li.entry').filter({ hasText: title })).toBeVisible();
      await returnToNotes(page, server);

      await server.stop();
      expireTrashEntry(server.databasePath, noteID);
      await server.start();
      await waitForStartupPurge(page, server, noteID);

      await page.getByTitle('Trash', { exact: true }).click();
      await expect(page).toHaveURL(`${server.baseURL}/trash`);
      await expect(page.locator('li.entry').filter({ hasText: title })).toHaveCount(0);
      await expect(page.getByText(/trash is empty/i)).toBeVisible();
    } finally {
      await server.dispose();
    }
  });

  test('refreshing Deleted after cleanup removes an entry from the open view', async ({ page }) => {
    const server = await startIsolatedServer();
    try {
      await login(page, server);
      const title = 'Purged while Deleted is open';
      const noteID = await createTrashedNote(page, server, title);
      await page.goto(`${server.baseURL}/trash`);
      const entry = page.locator('li.entry').filter({ hasText: title });
      await expect(entry).toBeVisible();

      await server.stop();
      expireTrashEntry(server.databasePath, noteID);
      await server.start();
      await waitForStartupPurge(page, server, noteID);

      await expect(entry).toBeVisible();
      await page.reload();
      await expect(entry).toHaveCount(0);
      await expect(page.getByText(/trash is empty/i)).toBeVisible();
    } finally {
      await server.dispose();
    }
  });
});
