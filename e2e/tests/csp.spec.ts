import { test, expect, type Page } from '@playwright/test';

// The enforced policy is two halves (docs/csp.md): the <meta> tag SvelteKit
// bakes into index.html, which owns script-src and the other resource
// directives, and the response header, which owns frame-ancestors. These tests
// assert what the browser actually enforces — the unit tests either side can
// only assert what each half is configured to say.

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** Records every CSP violation the page reports, before any page script runs. */
async function collectViolations(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        `${e.violatedDirective} blocked ${e.blockedURI}`,
      );
    });
  });
}

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);

test.describe('Content-Security-Policy', () => {
  test('the served page carries both halves of the policy', async ({ page }) => {
    const response = await page.goto('/login');
    const header = response?.headers()['content-security-policy'];

    // frame-ancestors cannot be expressed in a meta tag, so the header owns it
    // — and only it, so the two halves cannot intersect into a broken policy.
    expect(header).toBe("frame-ancestors 'none'");

    const meta = await page
      .locator('meta[http-equiv="content-security-policy"]')
      .getAttribute('content');
    expect(meta).toBeTruthy();

    const scriptSrc = /script-src ([^;]*)/.exec(meta ?? '')?.[1] ?? '';
    // A hash per build is what replaced 'unsafe-inline' — see issue #90.
    expect(scriptSrc).toContain("'sha256-");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(meta).not.toContain('unsafe-eval');
  });

  test('an inline script injected into the page does not execute', async ({ page }) => {
    await page.goto('/login');

    // The XSS case the policy exists for: markup that reaches the DOM and tries
    // to run script. page.evaluate itself is not subject to CSP, but the
    // <script> element it appends is.
    const ran = await page.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'window.__xssRan = true;';
      document.head.appendChild(s);
      return (window as unknown as { __xssRan?: boolean }).__xssRan === true;
    });

    expect(ran).toBe(false);
  });

  test('booting the SPA and editing a note raises no violations', async ({ page }) => {
    // If the build's own bootstrap, chunks, webfonts or the editor's inline
    // styles fell foul of the policy, they would show up here — this is the
    // test that fails when a build changes what index.html loads.
    await collectViolations(page);
    await login(page);

    const created = page.waitForResponse(
      (r) => r.url().includes('/api/notes') && r.request().method() === 'POST',
    );
    await page.getByLabel('New note').click();
    await created;

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('CSP check');
    await expect(editor).toContainText('CSP check');

    expect(await violations(page)).toEqual([]);
  });
});
