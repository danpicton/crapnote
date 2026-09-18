import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

test('preserves applied underline through saves, navigation, reload, and read-only mode', async ({ page }) => {
  await login(page);
  const created = await page.request.post('/api/notes', {
    data: { title: 'Underline round trip', body: '' },
  });
  expect(created.ok()).toBe(true);
  const note = await created.json() as { id: number };
  await page.goto(`/notes/${note.id}`);

  const text = 'Underlined café & tea';
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.pressSequentially(text);
  await editor.press('Control+A');

  const underlinedSave = page.waitForResponse((response) => {
    if (response.url().endsWith(`/api/notes/${note.id}`)
      && response.request().method() === 'PUT') {
      return response.request().postDataJSON()?.body?.includes('<u>') === true;
    }
    return false;
  });
  await page.getByTitle('Underline').click();
  await expect(editor.locator('u')).toHaveText(text);
  await expect(editor).not.toContainText('<u>');
  expect((await underlinedSave).ok()).toBe(true);

  await page.goto('/archive');
  await page.goBack();
  await expect(page.locator('.ProseMirror u')).toHaveText(text);

  await page.reload();
  await expect(page.locator('.ProseMirror u')).toHaveText(text);
  await expect(page.locator('.ProseMirror')).not.toContainText('<u>');

  const locked = page.waitForResponse((response) =>
    response.url().endsWith(`/api/notes/${note.id}/lock`)
      && response.request().method() === 'PATCH',
  );
  await page.getByTitle('Lock note').click();
  expect((await locked).ok()).toBe(true);
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
  await expect(page.locator('.ProseMirror u')).toHaveText(text);

  const unlocked = page.waitForResponse((response) =>
    response.url().endsWith(`/api/notes/${note.id}/lock`)
      && response.request().method() === 'PATCH',
  );
  await page.getByTitle('Unlock note').click();
  expect((await unlocked).ok()).toBe(true);
  await editor.click();
  await editor.press('Control+A');

  const plainSave = page.waitForResponse((response) => {
    if (response.url().endsWith(`/api/notes/${note.id}`)
      && response.request().method() === 'PUT') {
      return response.request().postDataJSON()?.body?.includes('<u>') === false;
    }
    return false;
  });
  await page.getByTitle('Underline').click();
  await expect(editor.locator('u')).toHaveCount(0);
  expect((await plainSave).ok()).toBe(true);

  await page.reload();
  await expect(page.locator('.ProseMirror')).toHaveText(text);
  await expect(page.locator('.ProseMirror u')).toHaveCount(0);
});
