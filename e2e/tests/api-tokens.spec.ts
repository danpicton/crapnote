import { test, expect, type Page, request } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

test.describe('API tokens', () => {
  test('admin can create, use, and revoke a token', async ({ page, baseURL }) => {
    await login(page);
    await page.goto('/settings');

    // Create a token via the Developer section UI.
    const tokenName = `e2e-${Date.now()}`;
    await page.getByPlaceholder(/token name/i).fill(tokenName);
    await page.getByRole('button', { name: /create token/i }).click();

    // The raw token is shown exactly once inside a <code class="token-value">.
    const tokenLocator = page.locator('code.token-value');
    await expect(tokenLocator).toBeVisible();
    const raw = (await tokenLocator.textContent())?.trim() ?? '';
    expect(raw).toMatch(/^cnp_/);

    // Fresh API-only client (no cookies) to prove bearer auth stands alone.
    const apiCtx = await request.newContext({ baseURL });

    // Use the token against a protected endpoint.
    const listRes = await apiCtx.get('/api/notes', {
      headers: { Authorization: `Bearer ${raw}` },
    });
    expect(listRes.status()).toBe(200);

    // Admin endpoints must be blocked for bearer auth even for admin users.
    const adminRes = await apiCtx.get('/api/admin/users', {
      headers: { Authorization: `Bearer ${raw}` },
    });
    expect(adminRes.status()).toBe(403);

    // Revoke via the UI.
    page.once('dialog', (d) => d.accept());
    await page
      .getByRole('row', { name: new RegExp(tokenName) })
      .getByRole('button', { name: /revoke token/i })
      .click();
    await expect(page.getByRole('row', { name: new RegExp(tokenName) })).toContainText(/revoked/i);

    // The revoked token must no longer work.
    const deniedRes = await apiCtx.get('/api/notes', {
      headers: { Authorization: `Bearer ${raw}` },
    });
    expect(deniedRes.status()).toBe(401);

    await apiCtx.dispose();
  });

  test('read-only scope cannot mutate', async ({ page, baseURL }) => {
    await login(page);
    await page.goto('/settings');

    const tokenName = `readonly-${Date.now()}`;
    await page.getByPlaceholder(/token name/i).fill(tokenName);
    await page.locator('select').selectOption('read');
    await page.getByRole('button', { name: /create token/i }).click();

    const raw = (await page.locator('code.token-value').textContent())?.trim() ?? '';
    expect(raw).toMatch(/^cnp_/);

    const apiCtx = await request.newContext({ baseURL });

    // Read is allowed.
    const listRes = await apiCtx.get('/api/notes', {
      headers: { Authorization: `Bearer ${raw}` },
    });
    expect(listRes.status()).toBe(200);

    // Write is not.
    const writeRes = await apiCtx.post('/api/notes', {
      headers: { Authorization: `Bearer ${raw}` },
      data: { title: 'nope' },
    });
    expect(writeRes.status()).toBe(403);

    await apiCtx.dispose();
  });
});
