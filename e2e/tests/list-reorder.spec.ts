import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** Create a note with a bullet list straight through the API and open it. */
async function openListNote(page: Page, title: string) {
  const id = await page.evaluate(async (t) => {
    const res = await fetch('/api/notes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: t, body: '- Alpha\n- Bravo\n- Charlie\n- Delta\n' }),
    });
    return (await res.json()).id as number;
  }, title);
  await page.goto(`/notes/${id}`);
  await page.waitForSelector('.ProseMirror li');
  return id;
}

const itemText = (page: Page) => page.locator('.ProseMirror li').allInnerTexts();

test.describe('List reordering', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // Regression: adding the drag class mutates DOM that ProseMirror owns. Without
  // an ignoreMutation hook on the NodeView, PM redrew the node and destroyed the
  // NodeView mid-gesture, cancelling every drag on the first frame.
  test('dragging a handle reorders the list', async ({ page }) => {
    await openListNote(page, 'Drag list');
    expect(await itemText(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);

    const items = page.locator('.ProseMirror li');
    const handle = page.locator('.ProseMirror .list-drag-handle').first();

    await items.nth(0).hover();
    const h = (await handle.boundingBox())!;
    const target = (await items.nth(2).boundingBox())!;

    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    // The dragged item is marked while the gesture is live.
    await expect(page.locator('.ProseMirror li.list-item-dragging')).toHaveCount(1);

    await page.mouse.move(target.x + 20, target.y + target.height * 0.8, { steps: 12 });
    // A drop indicator tracks where the item would land.
    await expect(page.locator('.list-drop-before, .list-drop-after')).toHaveCount(1);

    await page.mouse.up();

    await expect
      .poll(() => itemText(page))
      .toEqual(['Bravo', 'Charlie', 'Alpha', 'Delta']);
    // Nothing left marked once the gesture ends.
    await expect(page.locator('.list-item-dragging, .list-drop-before, .list-drop-after')).toHaveCount(0);
  });

  test('dragging upwards works too', async ({ page }) => {
    await openListNote(page, 'Drag up list');

    const items = page.locator('.ProseMirror li');
    await items.nth(3).hover();
    const h = (await page.locator('.ProseMirror .list-drag-handle').nth(3).boundingBox())!;
    const target = (await items.nth(0).boundingBox())!;

    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 20, target.y + 2, { steps: 12 });
    await page.mouse.up();

    await expect.poll(() => itemText(page)).toEqual(['Delta', 'Alpha', 'Bravo', 'Charlie']);
  });

  test('Escape abandons a drag without reordering', async ({ page }) => {
    await openListNote(page, 'Escape list');

    const items = page.locator('.ProseMirror li');
    await items.nth(0).hover();
    const h = (await page.locator('.ProseMirror .list-drag-handle').first().boundingBox())!;
    const target = (await items.nth(2).boundingBox())!;

    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 20, target.y + target.height * 0.8, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    expect(await itemText(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  // The grip sat above its text because a reduced font-size shrank the em box
  // the height was measured in.
  test('the handle is centred on the first line of its item', async ({ page }) => {
    await openListNote(page, 'Aligned list');

    const offset = await page.evaluate(() => {
      const li = document.querySelector('.ProseMirror li')!;
      const handle = li.querySelector('.list-drag-handle')!.getBoundingClientRect();
      const text = (li.querySelector('p') ?? li).getBoundingClientRect();
      return Math.abs(
        handle.top + handle.height / 2 - (text.top + text.height / 2),
      );
    });

    expect(offset).toBeLessThanOrEqual(1);
  });

  // The grip used to be a text glyph, which landed in the item's text content
  // and depended on the theme font having U+283F.
  test('the handle contributes no text to the list item', async ({ page }) => {
    await openListNote(page, 'Clean text list');
    expect(await itemText(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  test('keyboard shortcuts still reorder', async ({ page }) => {
    await openListNote(page, 'Keyboard list');

    await page.locator('.ProseMirror li').nth(0).click();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => itemText(page)).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']);

    await page.keyboard.press('Alt+Shift+ArrowDown');
    await expect.poll(() => itemText(page)).toEqual(['Bravo', 'Charlie', 'Delta', 'Alpha']);
  });
});

test.describe('List reordering on touch', () => {
  // No hover on touch, so a hover-only grip would be invisible and undraggable.
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 851 } });

  test('handles are visible without hovering', async ({ page }) => {
    await login(page);
    await openListNote(page, 'Touch list');

    const opacity = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.ProseMirror .list-drag-handle')!).opacity,
    );
    expect(Number(opacity)).toBeGreaterThan(0);
  });
});
