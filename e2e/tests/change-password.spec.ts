import { test, expect, type Page, request } from '@playwright/test';

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill(username);
  await page.getByRole('textbox', { name: /password/i }).fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/**
 * Creates a throwaway non-admin user through the admin API. The seeded admin's
 * own password must survive this spec — every other spec logs in with it — so
 * the password change is done to a user nothing else touches.
 */
async function createThrowawayUser(baseURL: string, username: string, password: string) {
  const adminCtx = await request.newContext({ baseURL });
  const loggedIn = await adminCtx.post('/api/auth/login', {
    data: { username: 'admin', password: 'admin123' },
  });
  expect(loggedIn.status()).toBe(200);
  const created = await adminCtx.post('/api/admin/users', {
    data: { username, password, is_admin: false },
  });
  expect(created.status()).toBe(201);
  await adminCtx.dispose();
}

test.describe('Change password', () => {
  test('a new password is accepted without the current one', async ({ page, baseURL }) => {
    const username = `e2e-pw-${Date.now()}`;
    const oldPassword = 'e2e-password-old';
    const newPassword = 'e2e-password-new';

    await createThrowawayUser(baseURL!, username, oldPassword);
    await login(page, username, oldPassword);
    await page.goto('/settings');
    await expect(page.locator('.account-name')).toHaveText(username);

    // The whole point of the flow: the form asks for the new password twice
    // and never for the current one (backend/internal/auth/handler.go).
    await expect(page.getByLabel(/current password/i)).toHaveCount(0);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText('Password updated.')).toBeVisible();

    // The change revokes every session for the user, including this one, so
    // logging in again is both the cleanup and the proof it took effect.
    await page.goto('/login');
    await login(page, username, newPassword);
    await expect(page.locator('.app-name')).toBeVisible();
  });
});
