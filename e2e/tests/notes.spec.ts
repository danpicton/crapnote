import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** Create a note, set the title, and blur it so the title is persisted. */
async function createNote(page: Page, title: string) {
  // Register the response listener BEFORE clicking so a fast create can't
  // arrive before the listener is attached (race condition).
  const created = page.waitForResponse(
    (r) => r.url().includes('/api/notes') && r.request().method() === 'POST',
  );
  await page.getByLabel('New note').filter({ visible: true }).click();
  await created;

  const titleInput = page.getByPlaceholder(/note title/i);
  // Wait for the editor to re-bind to the NEW note before typing. A fresh
  // note's title defaults to a timestamp ("2026-07-04 …"); until that value
  // appears, the visible title input still belongs to the previously
  // selected note and fill() would start a title draft for that one instead.
  await expect(titleInput).toHaveValue(/^\d{4}-\d{2}-\d{2}/);

  // fill() replaces any existing text atomically and fires Svelte's input
  // binding without needing keystroke delays or an explicit waitForTimeout.
  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/notes') && r.request().method() === 'PUT',
  );
  await titleInput.fill(title);
  await titleInput.press('Tab');
  await saved;
}

async function assertBulletConversion(
  page: Page,
  title: string,
  separator: 'Enter' | 'Shift+Enter',
  expectedItems: number,
  mobile: boolean,
) {
  await createNote(page, title);
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await editor.pressSequentially('Alpha');
  await editor.press(separator);
  await editor.pressSequentially('Beta');
  await editor.press(separator);
  await editor.pressSequentially('Gamma');
  await editor.press('Control+A');

  const saved = page.waitForResponse(
    (r) => r.url().includes('/api/notes') && r.request().method() === 'PUT',
  );
  const bulletButton = mobile
    ? page.getByRole('button', { name: 'Bullet list' })
    : page.getByTitle('Bullet list');
  await bulletButton.click();

  const items = editor.locator(':scope > ul > li');
  await expect(items).toHaveCount(expectedItems);
  await expect(items).toContainText(
    expectedItems === 3 ? ['Alpha', 'Beta', 'Gamma'] : ['AlphaBetaGamma'],
  );
  if (expectedItems === 1) await expect(items.locator('br')).toHaveCount(2);
  await saved;

  await page.reload();
  const reopenedItems = page.locator('.ProseMirror > ul > li');
  await expect(reopenedItems).toHaveCount(expectedItems);
  await expect(reopenedItems).toContainText(
    expectedItems === 3 ? ['Alpha', 'Beta', 'Gamma'] : ['AlphaBetaGamma'],
  );
  if (expectedItems === 1) await expect(reopenedItems.locator('br')).toHaveCount(2);
}

for (const { layout, viewport, mobile } of [
  { layout: 'desktop', viewport: { width: 1280, height: 900 }, mobile: false },
  { layout: 'mobile', viewport: { width: 390, height: 844 }, mobile: true },
]) {
  test.describe(`Bullet conversion on ${layout}`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page }) => {
      await login(page);
    });

    test('converts paragraphs but keeps hard breaks in one item and persists both', async ({ page }) => {
      await assertBulletConversion(page, `Paragraph bullets ${layout}`, 'Enter', 3, mobile);
      await page.goto('/');
      await assertBulletConversion(page, `Hard-break bullet ${layout}`, 'Shift+Enter', 1, mobile);
    });
  });
}

for (const [layout, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
] as const) {
  test.describe(`Title save recovery on ${layout}`, () => {
    test.use({ viewport, serviceWorkers: 'block' });

    test('reopens the successful title after an earlier save fell back to the offline cache', async ({ page }) => {
      await login(page);
      await createNote(page, `Original ${layout}`);
      const title = page.getByPlaceholder(/note title/i);
      await page.route('**/api/notes/*', async (route) => {
        if (route.request().method() === 'PUT' && route.request().postDataJSON().title === 'Failed title') {
          await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
        } else {
          await route.continue();
        }
      });
      const failed = page.waitForResponse((r) => r.request().method() === 'PUT' && r.status() === 503);
      await title.fill('Failed title');
      await title.press('Tab');
      await failed;
      await expect(page.getByText('Saving…', { exact: true })).not.toBeVisible();

      const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.status() === 200);
      await title.fill(`Recovered title ${layout}`);
      await title.press('Tab');
      await saved;
      await expect(page.getByText('Saving…', { exact: true })).not.toBeVisible();
      await page.reload();
      await expect(page.getByPlaceholder(/note title/i)).toHaveValue(`Recovered title ${layout}`);
    });
  });
}

test.describe('Mobile title drafts', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('restores blank drafts and saves the final title on browser back before reopening', async ({ page }) => {
    await login(page);
    await createNote(page, 'Mobile original title');
    const noteUrl = page.url();
    const title = page.getByPlaceholder(/note title/i);
    await title.fill('');
    await page.waitForTimeout(1000);
    await expect(title).toHaveValue('');
    await title.fill('   ');
    await title.press('Tab');
    await expect(title).toHaveValue('Mobile original title');

    await title.fill('Mobile saved on back');
    const saved = page.waitForResponse(
      (r) => r.url().includes('/api/notes') && r.request().method() === 'PUT',
    );
    await page.goBack();
    await saved;
    await expect(page).toHaveURL('/');
    await expect(page.locator('.note-item').filter({ hasText: 'Mobile saved on back' })).toBeVisible();
    await page.goto(noteUrl);
    await expect(page.getByPlaceholder(/note title/i)).toHaveValue('Mobile saved on back');
  });
});

test.describe('Notes', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can create a new note', async ({ page }) => {
    await page.getByLabel('New note').click();
    await expect(page.getByPlaceholder(/note title/i)).toBeVisible();
  });

  test('keeps a blank title draft until blur, then saves the replacement', async ({ page }) => {
    await createNote(page, 'Original title');
    const titleInput = page.getByPlaceholder(/note title/i);

    await titleInput.fill('');
    await page.waitForTimeout(1000);
    await expect(titleInput).toHaveValue('');
    await expect(page.locator('.note-item.selected .note-title')).toHaveText('Original title');

    await titleInput.fill('Replacement title');
    await expect(page.locator('.note-item.selected .note-title')).toHaveText('Original title');
    const saved = page.waitForResponse(
      (r) => r.url().includes('/api/notes') && r.request().method() === 'PUT',
    );
    await titleInput.press('Tab');
    await saved;

    await page.reload();
    await expect(page.locator('.note-item').filter({ hasText: 'Replacement title' })).toBeVisible();
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
    await titleInput.press('Tab');
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

  test('can reach the trash from the sidebar and restore a note', async ({ page }) => {
    await createNote(page, 'To Untrash');

    const noteItem = page.locator('.note-item.selected');
    await noteItem.hover();
    await noteItem.getByTitle('Delete').click();
    await expect(page.locator('.note-item').filter({ hasText: 'To Untrash' })).not.toBeVisible();

    // The trash must be reachable from the nav, not just by typing the URL.
    const trashed = page.waitForResponse((r) => r.url().includes('/api/trash'));
    await page.getByTitle('Trash').click();
    await expect(page).toHaveURL('/trash');
    await trashed;
    // The suite shares one database, so other tests' deletions sit here too —
    // scope to this note's row.
    const row = page.locator('li.entry').filter({ hasText: 'To Untrash' });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: /restore note/i }).click();
    await expect(row).not.toBeVisible();

    await page.goto('/');
    await expect(page.locator('.note-item').filter({ hasText: 'To Untrash' })).toBeVisible();
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
