import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  // Clear any existing session cookie so the layout's onMount auth-redirect
  // doesn't race with the form submission when a prior test left a valid session.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** Create a note, set the title, and wait for autosave to persist it. */
async function createNote(page: Page, title: string) {
  await page.getByLabel('New note').click();
  const titleInput = page.getByPlaceholder(/note title/i);
  // Register the response listener BEFORE fill() so a fast autosave can't
  // arrive before the listener is attached (race condition).
  // fill() replaces any existing text atomically and fires Svelte's input
  // binding without needing keystroke delays or an explicit waitForTimeout.
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/notes') && r.request().method() === 'PUT',
  );
  await titleInput.fill(title);
  await saved;
}

test.describe('Notes', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can create a new note', async ({ page }) => {
    await page.getByLabel('New note').click();
    await expect(page.getByPlaceholder(/note title/i)).toBeVisible();
  });

  test('title change does not erase body', async ({ page }) => {
    await createNote(page, 'My Note');

    // Type in editor (ProseMirror is a contenteditable — pressSequentially is
    // correct here; fill() does not work on rich-text editors).
    const editor = page.locator('.ProseMirror');
    await editor.click();
    const bodySaved = page.waitForResponse(
      (r) => r.url().includes('/api/notes') && r.request().method() === 'PUT',
    );
    await editor.pressSequentially('Hello world');
    await bodySaved;

    // Rename the note
    const titleInput = page.getByPlaceholder(/note title/i);
    const titleSaved = page.waitForResponse(
      (r) => r.url().includes('/api/notes') && r.request().method() === 'PUT',
    );
    await titleInput.fill('Renamed Note');
    await titleSaved;

    // Reload to confirm both title and body persisted
    await page.reload();
    await page.getByText('Renamed Note').click();
    await expect(page.locator('.ProseMirror')).toContainText('Hello world');
  });

  test('can delete a note', async ({ page }) => {
    await createNote(page, 'To Delete');

    // The selected note item is the one we just created
    const noteItem = page.locator('.note-item.selected');
    await noteItem.hover();
    await noteItem.getByTitle('Delete').click();

    await expect(page.locator('.note-item').filter({ hasText: 'To Delete' })).not.toBeVisible();
  });

  test('can archive and restore a note', async ({ page }) => {
    await createNote(page, 'To Archive');

    // Archive the selected note
    const noteItem = page.locator('.note-item.selected');
    await noteItem.hover();
    await noteItem.getByRole('button', { name: /move to archive/i }).click();
    await expect(page.locator('.note-item').filter({ hasText: 'To Archive' })).not.toBeVisible();

    // Check archive page
    await page.goto('/archive');
    await page.waitForResponse((r) => r.url().includes('/api/archive'));
    await expect(page.getByText('To Archive')).toBeVisible();

    // Restore
    await page.getByRole('button', { name: /restore from archive/i }).click();
    await expect(page.getByText('To Archive')).not.toBeVisible();
  });

  test('search filters the note list', async ({ page }) => {
    await createNote(page, 'Apple note');
    await createNote(page, 'Banana note');

    const searchBox = page.getByPlaceholder(/search/i);
    const searchDone = page.waitForResponse(
      (r) => r.url().includes('/api/notes') && r.url().includes('search=Apple'),
    );
    await searchBox.fill('Apple');
    await searchDone;

    await expect(page.locator('.note-item').filter({ hasText: 'Apple note' }).first()).toBeVisible();
    await expect(page.locator('.note-item').filter({ hasText: 'Banana note' })).not.toBeVisible();
  });
});
