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

/** Create a new tag via the popover's "New tag…" input. */
async function createTagInPopover(page: Page, name: string) {
  await page.getByPlaceholder('New tag…').fill(name);
  await page.getByPlaceholder('New tag…').press('Enter');
  await page.waitForResponse((r) => r.url().includes('/api/tags') && r.request().method() === 'POST');
}

test.describe('Tags', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('can create a tag and apply it to a note', async ({ page }) => {
    await createNote(page, 'Tag test note');
    await openTagPopover(page);
    await createTagInPopover(page, 'e2e-tag');

    // Chip appears below the title
    await expect(page.locator('.note-tag-chip', { hasText: 'e2e-tag' })).toBeVisible();

    // Checkbox in popover is checked
    const checkbox = page.locator('.popover-item').filter({ hasText: 'e2e-tag' }).locator('input[type=checkbox]');
    await expect(checkbox).toBeChecked();
  });

  test('tag appears in sidebar filter after being applied', async ({ page }) => {
    await createNote(page, 'Sidebar filter note');
    await openTagPopover(page);
    await createTagInPopover(page, 'sidebar-tag');

    // Sidebar pill should appear
    await expect(page.locator('.filter-tags .tag-pill', { hasText: 'sidebar-tag' })).toBeVisible();
  });

  test('filtering by tag shows only tagged notes', async ({ page }) => {
    // Create two notes; tag only the first
    await createNote(page, 'Tagged note');
    await openTagPopover(page);
    await createTagInPopover(page, 'filter-tag');
    await page.keyboard.press('Escape'); // close popover

    await createNote(page, 'Untagged note');

    // Click the tag filter pill
    await page.locator('.filter-tags .tag-pill', { hasText: 'filter-tag' }).click();
    await page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'GET');

    // Only tagged note visible in list
    await expect(page.getByRole('list').getByText('Tagged note')).toBeVisible();
    await expect(page.getByRole('list').getByText('Untagged note')).not.toBeVisible();
  });

  test('"All" pill restores full note list', async ({ page }) => {
    await createNote(page, 'Note A');
    await openTagPopover(page);
    await createTagInPopover(page, 'restore-tag');
    await page.keyboard.press('Escape');

    await createNote(page, 'Note B');

    // Activate tag filter
    await page.locator('.filter-tags .tag-pill', { hasText: 'restore-tag' }).click();
    await page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'GET');
    await expect(page.getByRole('list').getByText('Note B')).not.toBeVisible();

    // Click All
    await page.locator('.filter-fixed .tag-pill', { hasText: 'All' }).click();
    await page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'GET');
    await expect(page.getByRole('list').getByText('Note B')).toBeVisible();
  });

  test('clicking a tag chip in the editor activates the filter', async ({ page }) => {
    await createNote(page, 'Chip filter note');
    await openTagPopover(page);
    await createTagInPopover(page, 'chip-tag');

    // Click the chip below the title
    await page.locator('.note-tag-chip', { hasText: 'chip-tag' }).click();
    await page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'GET');

    // Sidebar filter pill should be active (has box-shadow / active class)
    await expect(page.locator('.filter-tags .tag-pill.tag-pill-active', { hasText: 'chip-tag' })).toBeVisible();
  });

  test('can remove a tag from a note', async ({ page }) => {
    await createNote(page, 'Remove tag note');
    await openTagPopover(page);
    await createTagInPopover(page, 'remove-tag');

    // Uncheck via popover
    const checkbox = page.locator('.popover-item').filter({ hasText: 'remove-tag' }).locator('input[type=checkbox]');
    await checkbox.uncheck();
    await page.waitForResponse((r) => r.url().includes('/api/notes') && r.url().includes('/tags/') && r.request().method() === 'DELETE');

    // Chip should be gone
    await expect(page.locator('.note-tag-chip', { hasText: 'remove-tag' })).not.toBeVisible();
  });

  test('starred filter shows only starred notes', async ({ page }) => {
    await createNote(page, 'Starred note');
    // Star it via the sidebar action button
    await page.locator('.note-item').filter({ hasText: 'Starred note' }).hover();
    await page.locator('.note-item').filter({ hasText: 'Starred note' }).getByTitle('Star').click();
    await page.waitForResponse((r) => r.url().includes('/star') && r.request().method() === 'PATCH');

    await createNote(page, 'Plain note');

    // Activate starred filter
    await page.locator('.filter-fixed .tag-pill', { hasText: 'Starred' }).click();
    await page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'GET');

    await expect(page.getByRole('list').getByText('Starred note')).toBeVisible();
    await expect(page.getByRole('list').getByText('Plain note')).not.toBeVisible();
  });

  test('tag disappears from filter when no notes have it', async ({ page }) => {
    await createNote(page, 'Solo tag note');
    await openTagPopover(page);
    await createTagInPopover(page, 'solo-tag');

    await expect(page.locator('.filter-tags .tag-pill', { hasText: 'solo-tag' })).toBeVisible();

    // Remove the tag from the note
    const checkbox = page.locator('.popover-item').filter({ hasText: 'solo-tag' }).locator('input[type=checkbox]');
    await checkbox.uncheck();
    await page.waitForResponse((r) => r.url().includes('/tags/') && r.request().method() === 'DELETE');

    // Pill should disappear (pseudo-erasure)
    await expect(page.locator('.filter-tags .tag-pill', { hasText: 'solo-tag' })).not.toBeVisible();
  });
});
