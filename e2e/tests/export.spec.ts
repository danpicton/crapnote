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

  test('exports then imports and opens a note with its restored image', async ({ page }) => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const uploaded = await page.request.post('/api/images', {
      multipart: { image: { name: 'pixel.png', mimeType: 'image/png', buffer: png } },
    });
    expect(uploaded.status()).toBe(201);
    const oldImageURL = ((await uploaded.json()) as { url: string }).url;
    const title = `Import image ${Date.now()}`;
    const created = await page.request.post('/api/notes', {
      data: { title, body: `![restored pixel](${oldImageURL})` },
    });
    expect(created.status()).toBe(201);
    const source = (await created.json()) as { id: number };

    await page.goto('/settings');
    const downloadEvent = page.waitForEvent('download');
    await page.getByPlaceholder(/password \(optional\)/i).fill('round-trip-password');
    await page.getByRole('button', { name: /export notes/i }).click();
    const download = await downloadEvent;
    const archivePath = await download.path();
    expect(archivePath).not.toBeNull();

    // Remove the source so the only active note with this title is the import.
    expect((await page.request.delete(`/api/notes/${source.id}`)).status()).toBe(204);
    await page.getByLabel(/crapnote export zip/i).setInputFiles(archivePath!);
    await page.getByLabel(/export password/i).fill('round-trip-password');
    await page.getByRole('button', { name: /import notes/i }).click();
    await expect(page.getByRole('status')).toContainText(/Imported \d+ notes/);

    await page.goto('/');
    const imported = page.locator('.note-item').filter({ hasText: title });
    await expect(imported).toHaveCount(1);
    await imported.click();
    const restoredImage = page.getByAltText('restored pixel');
    await expect(restoredImage).toBeVisible();
    await expect(restoredImage).not.toHaveAttribute('src', oldImageURL);
    await expect(restoredImage).toHaveAttribute('src', /^\/api\/images\/[a-f0-9-]+$/);
  });
});
