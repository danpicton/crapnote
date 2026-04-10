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
  await page.getByLabel('New note').click();
  const titleInput = page.getByPlaceholder(/note title/i);
  // triple-click selects all existing text, then type replaces it atomically
  await titleInput.click({ clickCount: 3 });
  // Wait a tick so Svelte's one-way binding doesn't re-set the value mid-type
  await page.waitForTimeout(50);
  await titleInput.pressSequentially(title, { delay: 20 });
  // Wait for the 800ms autosave debounce + network round-trip
  await page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'PUT');
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

    // Type in editor
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Hello world');

    // Wait for body autosave
    await page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'PUT');

    // Rename the note
    const titleInput = page.getByPlaceholder(/note title/i);
    await titleInput.clear();
    await titleInput.pressSequentially('Renamed Note', { delay: 20 });
    await page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'PUT');

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
    await searchBox.click();
    // Register the response waiter before typing so fast responses aren't missed.
    // Prior runs may have left duplicate 'Apple note' entries in the DB; use
    // .first() so the assertion doesn't fail on strict-mode multi-element matches.
    const searchDone = page.waitForResponse(
      (r) => r.url().includes('/api/notes') && r.url().includes('search=Apple')
    );
    await page.keyboard.type('Apple');
    await searchDone;

    await expect(page.locator('.note-item').filter({ hasText: 'Apple note' }).first()).toBeVisible();
    await expect(page.locator('.note-item').filter({ hasText: 'Banana note' })).not.toBeVisible();
  });
});
