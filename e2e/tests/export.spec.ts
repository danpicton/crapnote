import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

test.describe('Export', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Give the export something to carry, so the spec holds up when run alone
    // against a database no other spec has written to yet.
    const created = await page.request.post('/api/notes', {
      data: { title: `Export ${Date.now()}`, body: 'Exported body' },
    });
    expect(created.status()).toBe(201);
  });

  test('POST /api/export returns a password-protected ZIP attachment', async ({ page }) => {
    const res = await page.request.post('/api/export', {
      data: { password: 'e2e-export-pass' },
    });

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/zip');
    expect(res.headers()['content-disposition']).toMatch(
      /^attachment; filename="crapnote-export-\d{4}-\d{2}-\d{2}\.zip"$/,
    );

    // The headers alone don't prove the body is an archive — check the ZIP
    // magic bytes. What is inside it is the Go export tests' business.
    const body = await res.body();
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');

    // ...and 'PK' alone is also an unencrypted archive, so check that the
    // password was applied: bit 0 of the local file header's general-purpose
    // flag (byte 6) marks an encrypted entry. This build writes 0x09 there
    // with a password and 0x08 without one.
    expect(body[6] & 0x01).toBe(1);
  });

  test('the settings page downloads the export', async ({ page }) => {
    await page.goto('/settings');

    // Register the listener before clicking: the export is small enough that
    // the download can land before an after-the-fact wait attaches.
    const download = page.waitForEvent('download');
    await page.getByPlaceholder(/password \(optional\)/i).fill('e2e-export-pass');
    await page.getByRole('button', { name: /export notes/i }).click();

    expect((await download).suggestedFilename()).toMatch(
      /^crapnote-export-\d{4}-\d{2}-\d{2}\.zip$/,
    );
  });
});
