import { expect, type Page } from '@playwright/test';

/** Create through the UI and finish title editing before waiting for persistence.
 * All suites use this so setup follows the same blur-to-save contract as users.
 */
export async function createNote(page: Page, title: string): Promise<void> {
  const created = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/notes' && r.request().method() === 'POST',
  );
  await page.getByLabel('New note').filter({ visible: true }).click();
  const createdResponse = await created;
  expect(createdResponse.ok()).toBe(true);
  const note = (await createdResponse.json()) as { id: number; title: string };

  const titleInput = page.getByPlaceholder(/note title/i);
  // The create response can arrive before Svelte selects the new note.
  await expect(titleInput).toHaveValue(/^\d{4}-\d{2}-\d{2}/);
  await expect(titleInput).toHaveValue(note.title);

  // Register before the edit/blur: a fast response must not escape the waiter.
  // Match the source note and the submitted title, not an unrelated body save.
  const saved = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/notes/${note.id}`
      && r.request().method() === 'PUT'
      && r.request().postDataJSON()?.title === title,
  );
  await titleInput.fill(title);
  await titleInput.press('Tab');
  const savedResponse = await saved;
  expect(savedResponse.ok()).toBe(true);
  expect(await savedResponse.json()).toMatchObject({ id: note.id, title });
}
