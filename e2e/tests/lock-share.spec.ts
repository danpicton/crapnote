import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** Create a note, set the title, and wait for autosave to persist it. */
async function createNote(page: Page, title: string) {
  const created = page.waitForResponse(
    (r) => r.url().includes('/api/notes') && r.request().method() === 'POST',
  );
  await page.getByLabel('New note').click();
  await created;

  const titleInput = page.getByPlaceholder(/note title/i);
  await expect(titleInput).toHaveValue(/^\d{4}-\d{2}-\d{2}/);

  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/notes') && r.request().method() === 'PUT',
  );
  await titleInput.fill(title);
  await saved;
}

test.describe('Note locking', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('locking a note makes it read-only until unlocked', async ({ page }) => {
    await createNote(page, 'Lock me');

    const titleInput = page.getByPlaceholder(/note title/i);
    await expect(titleInput).not.toHaveAttribute('readonly', /.*/);

    const locked = page.waitForResponse(
      (r) => r.url().includes('/lock') && r.request().method() === 'PATCH',
    );
    await page.getByTitle('Lock note').click();
    await locked;

    await expect(titleInput).toHaveAttribute('readonly', /.*/);
    await expect(page.getByTitle('Unlock note')).toBeVisible();

    const unlocked = page.waitForResponse(
      (r) => r.url().includes('/lock') && r.request().method() === 'PATCH',
    );
    await page.getByTitle('Unlock note').click();
    await unlocked;

    await expect(titleInput).not.toHaveAttribute('readonly', /.*/);
  });

  test('the API rejects edits to a locked note with 423', async ({ page }) => {
    await createNote(page, 'Server enforced');

    // Read the note id back from the list request the app already made.
    const noteId = await page.evaluate(async () => {
      const res = await fetch('/api/notes?limit=100', { credentials: 'include' });
      const notes = await res.json();
      return notes.find((n: { title: string }) => n.title === 'Server enforced').id as number;
    });

    const lockStatus = await page.evaluate(async (id) => {
      const res = await fetch(`/api/notes/${id}/lock`, {
        method: 'PATCH',
        credentials: 'include',
      });
      return res.status;
    }, noteId);
    expect(lockStatus).toBe(200);

    // Bypassing the UI entirely: the server must still refuse.
    const updateStatus = await page.evaluate(async (id) => {
      const res = await fetch(`/api/notes/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'hacked' }),
      });
      return res.status;
    }, noteId);
    expect(updateStatus).toBe(423);

    const deleteStatus = await page.evaluate(async (id) => {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE', credentials: 'include' });
      return res.status;
    }, noteId);
    expect(deleteStatus).toBe(423);

    // Starring is metadata, not content — it stays available while locked.
    const starStatus = await page.evaluate(async (id) => {
      const res = await fetch(`/api/notes/${id}/star`, {
        method: 'PATCH',
        credentials: 'include',
      });
      return res.status;
    }, noteId);
    expect(starStatus).toBe(200);
  });
});

test.describe('Share target', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('a shared link becomes a new note', async ({ page }) => {
    await page.goto(
      '/share?title=Shared%20article&text=Worth%20reading&url=https%3A%2F%2Fexample.com%2Fpost',
    );

    // The share handler creates the note and redirects straight to it.
    await expect(page).toHaveURL(/\/notes\/\d+$/);
    await expect(page.getByPlaceholder(/note title/i)).toHaveValue('Shared article');
    await expect(page.getByText('Worth reading')).toBeVisible();
    await expect(page.getByText('https://example.com/post')).toBeVisible();
  });

  test('a share with no content goes to the notes list', async ({ page }) => {
    await page.goto('/share');
    await expect(page).toHaveURL('/');
  });
});
