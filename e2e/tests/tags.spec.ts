import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

async function createNote(page: Page, title: string) {
  await page.getByLabel('New note').click();
  const titleInput = page.getByPlaceholder(/note title/i);
  await titleInput.click({ clickCount: 3 });
  await page.waitForTimeout(50);
  await titleInput.pressSequentially(title, { delay: 20 });
  await page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'PUT');
}

/** Open the tag popover for the currently selected note. */
async function openTagPopover(page: Page) {
  await page.getByTitle('Tags').click();
  await expect(page.getByText('Tags', { exact: true }).first()).toBeVisible();
}

/** Create a new tag via the popover's "New tag…" input and wait for the chip. */
async function createTagInPopover(page: Page, name: string) {
  // pressSequentially fires individual input events so Svelte's bind:value
  // updates newTagName before Enter is pressed.
  const input = page.getByPlaceholder('New tag…');
  await input.click();
  await input.pressSequentially(name, { delay: 20 });
  await input.press('Enter');
  // Assert the actual outcome rather than a specific network call — the POST
  // URL differs depending on whether the tag pre-exists in the DB.
  await expect(page.locator('.note-tag-chip', { hasText: name })).toBeVisible();
}

/** Open the Tags pane-tab to reveal the tag panel. */
async function openTagsTab(page: Page) {
  await page.getByRole('group', { name: /filter notes/i }).getByRole('button', { name: /^tags/i }).click();
  await expect(page.getByRole('group', { name: /tag filters/i })).toBeVisible();
}

test.describe('Tags', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can create a tag and apply it to a note', async ({ page }) => {
    await createNote(page, 'Tag test note');
    await openTagPopover(page);
    await createTagInPopover(page, 'e2e-tag');

    // Chip appears in the editor status bar
    await expect(page.locator('.note-tag-chip', { hasText: 'e2e-tag' })).toBeVisible();

    // Reopen popover (it closes automatically after tag creation) and check the checkbox
    await openTagPopover(page);
    const checkbox = page.locator('.popover-item').filter({ hasText: 'e2e-tag' }).locator('input[type=checkbox]');
    await expect(checkbox).toBeChecked();
  });

  test('tag appears in tag panel after being applied', async ({ page }) => {
    await createNote(page, 'Sidebar filter note');
    await openTagPopover(page);
    await createTagInPopover(page, 'sidebar-tag');

    // Open the Tags pane-tab to reveal the tag panel
    await openTagsTab(page);
    await expect(page.locator('.tag-panel-item', { hasText: 'sidebar-tag' })).toBeVisible();
  });

  test('filtering by tag shows only tagged notes', async ({ page }) => {
    // Create two notes; tag only the first
    await createNote(page, 'Tagged note');
    await openTagPopover(page);
    await createTagInPopover(page, 'filter-tag');
    await page.keyboard.press('Escape'); // close popover

    await createNote(page, 'Untagged note');

    // Open the Tags tab then click the tag in the panel
    await openTagsTab(page);
    const filterDone = page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'GET');
    await page.locator('.tag-panel-item', { hasText: 'filter-tag' }).click();
    await filterDone;

    // Only tagged note visible in list
    await expect(page.getByRole('list').getByText('Tagged note')).toBeVisible();
    await expect(page.getByRole('list').getByText('Untagged note')).not.toBeVisible();
  });

  test('"All" tab restores full note list', async ({ page }) => {
    await createNote(page, 'Note A');
    await openTagPopover(page);
    await createTagInPopover(page, 'restore-tag');
    await page.keyboard.press('Escape');

    await createNote(page, 'Note B');

    // Activate tag filter via the Tags pane-tab
    await openTagsTab(page);
    let notesDone = page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'GET');
    await page.locator('.tag-panel-item', { hasText: 'restore-tag' }).click();
    await notesDone;
    await expect(page.getByRole('list').getByText('Note B')).not.toBeVisible();

    // Click the All/Filtered tab to restore the full list
    notesDone = page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'GET');
    await page.getByRole('group', { name: /filter notes/i }).getByRole('button', { name: /^(all|filtered)/i }).click();
    await notesDone;
    await expect(page.getByRole('list').getByText('Note B')).toBeVisible();
  });

  test('clicking a tag chip in the editor activates the filter', async ({ page }) => {
    await createNote(page, 'Chip filter note');
    await openTagPopover(page);
    await createTagInPopover(page, 'chip-tag');

    // Click the chip — this activates the tag filter and opens the tag panel
    const filterDone = page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'GET');
    await page.locator('.note-tag-chip', { hasText: 'chip-tag' }).click();
    await filterDone;

    // The Tags tab should be active and the tag item highlighted in the panel
    await expect(page.locator('.tag-panel-item.tag-panel-active', { hasText: 'chip-tag' })).toBeVisible();
  });

  test('can remove a tag from a note', async ({ page }) => {
    await createNote(page, 'Remove tag note');
    await openTagPopover(page);
    await createTagInPopover(page, 'remove-tag');

    // Reopen popover (it closes automatically after tag creation) and uncheck
    await openTagPopover(page);
    const checkbox = page.locator('.popover-item').filter({ hasText: 'remove-tag' }).locator('input[type=checkbox]');
    const deleteDone = page.waitForResponse((r) => r.url().includes('/api/notes') && r.url().includes('/tags/') && r.request().method() === 'DELETE');
    await checkbox.uncheck();
    await deleteDone;

    // Chip should be gone
    await expect(page.locator('.note-tag-chip', { hasText: 'remove-tag' })).not.toBeVisible();
  });

  test('starred filter shows only starred notes', async ({ page }) => {
    await createNote(page, 'Starred note');

    // Star it — use .first() to tolerate a duplicate from a prior retry
    const noteItem = page.locator('.note-item').filter({ hasText: 'Starred note' }).first();
    await noteItem.hover();
    const starDone = page.waitForResponse((r) => r.url().includes('/star') && r.request().method() === 'PATCH');
    await noteItem.getByTitle('Star').click();
    await starDone;

    await createNote(page, 'Plain note');

    // Activate starred filter via the Starred pane-tab
    const filterDone = page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'GET');
    await page.getByRole('group', { name: /filter notes/i }).getByRole('button', { name: /^starred/i }).click();
    await filterDone;

    await expect(page.getByRole('list').getByText('Starred note')).toBeVisible();
    await expect(page.getByRole('list').getByText('Plain note')).not.toBeVisible();
  });

  test('tag disappears from tag panel when no notes have it', async ({ page }) => {
    await createNote(page, 'Solo tag note');
    await openTagPopover(page);
    await createTagInPopover(page, 'solo-tag');

    // Tag appears in panel
    await openTagsTab(page);
    await expect(page.locator('.tag-panel-item', { hasText: 'solo-tag' })).toBeVisible();

    // Remove the tag — register wait before unchecking
    await openTagPopover(page);
    const checkbox = page.locator('.popover-item').filter({ hasText: 'solo-tag' }).locator('input[type=checkbox]');
    const deleteDone = page.waitForResponse((r) => r.url().includes('/tags/') && r.request().method() === 'DELETE');
    await checkbox.uncheck();
    await deleteDone;

    // Tag panel item should disappear (pseudo-erasure)
    await expect(page.locator('.tag-panel-item', { hasText: 'solo-tag' })).not.toBeVisible();
  });
});
