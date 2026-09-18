import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

test.describe('Editor Markdown copy', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('pastes selected bullets as Markdown and flattens underline', async ({ page }) => {
    await login(page);
    const created = await page.request.post('/api/notes', {
      data: {
        title: 'Markdown clipboard',
        body: '- First item\n- Second item\n\nUnderline me',
      },
    });
    expect(created.ok()).toBe(true);
    const note = await created.json() as { id: number };
    await page.goto(`/notes/${note.id}`);

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    const lastParagraph = editor.locator('p').last();
    await lastParagraph.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    const bodySaved = page.waitForResponse(
      (response) => response.url().endsWith(`/api/notes/${note.id}`)
        && response.request().method() === 'PUT',
    );
    await page.getByTitle('Underline').click();
    await expect(lastParagraph.locator('u')).toHaveText('Underline me');
    await bodySaved;

    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+C');

    const target = page.locator('#plain-text-paste');
    await page.evaluate(() => {
      const textarea = document.createElement('textarea');
      textarea.id = 'plain-text-paste';
      document.body.appendChild(textarea);
      textarea.focus();
    });
    await page.keyboard.press('Control+V');

    const expected = '* First item\n\n* Second item\n\nUnderline me\n';
    await expect(target).toHaveValue(expected);

    // The browser Copy action follows the same DOM copy event path as the
    // keyboard shortcut, so it receives the same Markdown payload.
    await editor.click();
    await page.keyboard.press('Control+A');
    expect(await page.evaluate(() => document.execCommand('copy'))).toBe(true);
    await target.fill('');
    await target.focus();
    await page.keyboard.press('Control+V');
    await expect(target).toHaveValue(expected);

    // Locked notes use the same mounted editor in read-only mode and remain
    // copyable. Keeping this editor mounted also avoids exercising underline
    // persistence, which is outside this issue.
    const lockResponse = page.waitForResponse(
      (response) => response.url().endsWith(`/api/notes/${note.id}/lock`)
        && response.request().method() === 'PATCH',
    );
    await page.getByTitle('Lock note').click();
    expect((await lockResponse).ok()).toBe(true);
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await editor.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press('Control+C');
    await target.fill('');
    await target.focus();
    await page.keyboard.press('Control+V');
    await expect(target).toHaveValue(expected);

    // The editor plugin is scoped to ProseMirror and must not change ordinary
    // page selection copying.
    await page.evaluate(() => {
      const outside = document.createElement('p');
      outside.id = 'outside-selection';
      outside.textContent = 'ordinary page text';
      document.body.appendChild(outside);
      const range = document.createRange();
      range.selectNodeContents(outside);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press('Control+C');
    await target.fill('');
    await target.focus();
    await page.keyboard.press('Control+V');
    await expect(target).toHaveValue('ordinary page text');
  });
});
