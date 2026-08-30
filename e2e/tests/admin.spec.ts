import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, username = 'admin', password = 'admin123') {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill(username);
  await page.getByRole('textbox', { name: /password/i }).fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

async function logout(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login/);
}

// The E2E database is shared by every spec in a run, so each test mints its own
// username. Passwords must clear the server's 12-character minimum.
const password = 'e2e-password-123';

test.describe('User management', () => {
  test('an admin creates a user who can then log in', async ({ page }) => {
    const username = `e2e-user-${Date.now()}`;

    await login(page);
    // Reached the way an admin reaches it: the settings link, which only
    // renders for admins.
    await page.goto('/settings');
    await page.getByRole('link', { name: /user management/i }).click();
    await expect(page).toHaveURL('/admin');

    await page.getByPlaceholder('Username').fill(username);
    await page.getByPlaceholder('Password', { exact: true }).fill(password);
    await page.getByPlaceholder('Confirm password').fill(password);
    await page.getByRole('button', { name: /create user/i }).click();

    // The table reloads from the server after a successful create, so the row
    // appearing proves the user was persisted, not just optimistically drawn.
    const row = page.getByRole('row', { name: new RegExp(username) });
    await expect(row).toBeVisible();
    await expect(row.locator('.col-role')).toHaveText('User');

    await logout(page);

    await login(page, username, password);
    await expect(page.locator('.app-name')).toBeVisible();
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ username, is_admin: false });
  });

  test('a non-admin has no user management link and cannot reach /admin', async ({ page }) => {
    const username = `e2e-plain-${Date.now()}`;

    await login(page);
    const created = await page.request.post('/api/admin/users', {
      data: { username, password, is_admin: false },
    });
    expect(created.status()).toBe(201);
    await logout(page);

    await login(page, username, password);
    await page.goto('/settings');
    // Wait for the identity to land before asserting an absence — the
    // administration section is gated on auth having loaded, so asserting too
    // early would pass for the wrong reason.
    await expect(page.locator('.account-name')).toHaveText(username);
    await expect(page.getByRole('link', { name: /user management/i })).toHaveCount(0);

    // A full page load of /admin: the guard waits for the session to settle
    // before deciding, so this exercises the admin gate rather than the
    // not-yet-loaded state (see the direct-load test for the admin side).
    await page.goto('/admin');
    await expect(page).toHaveURL('/');
    // The endpoint behind the screen refuses them too.
    const denied = await page.request.get('/api/admin/users');
    expect(denied.status()).toBe(403);
  });

  test('an admin can load /admin directly', async ({ page }) => {
    await login(page);

    // A fresh navigation, not a client-side one: the guard must wait for the
    // root layout's session check instead of reading a still-empty auth store.
    await page.goto('/admin');

    await expect(page.getByRole('row', { name: /^admin/ }).first()).toBeVisible();
    await expect(page).toHaveURL('/admin');

    // A reload lands in the same place.
    await page.reload();
    await expect(page.getByRole('row', { name: /^admin/ }).first()).toBeVisible();
    await expect(page).toHaveURL('/admin');
  });

  test('a logged-out visitor loading /admin lands on /login', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });
});
