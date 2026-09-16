import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill('admin');
  await page.getByRole('textbox', { name: /password/i }).fill('admin123');
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).toHaveURL('/');
}

/** Create a note with a list straight through the API and open it. */
async function openListNote(
  page: Page,
  title: string,
  body = '- Alpha\n- Bravo\n- Charlie\n- Delta\n',
) {
  const id = await page.evaluate(async ({ title: t, body: b }) => {
    const res = await fetch('/api/notes', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: t, body: b }),
    });
    return (await res.json()).id as number;
  }, { title, body });
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

  test('task controls form aligned columns centred on the first text line', async ({ page }) => {
    await openListNote(
      page,
      'Aligned tasks',
      '- [ ] A deliberately long checklist item that wraps onto another line so the controls must remain beside its first line rather than the whole row, even in the wide desktop editor where there is substantially more room for the sentence before it wraps onto its continuation\n- [x] Short item\n',
    );

    const geometry = await page.locator('.ProseMirror li[data-item-type="task"]').evaluateAll((items) =>
      items.map((item) => {
        const handle = item.querySelector('.list-drag-handle')!.getBoundingClientRect();
        const grip = item.querySelector('.list-drag-handle svg')!.getBoundingClientRect();
        const checkbox = item.querySelector('.task-checkbox')!.getBoundingClientRect();
        const text = item.querySelector('.task-content p')!.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(item).lineHeight);
        const firstLineCentre = text.top + lineHeight / 2;
        return {
          handleX: handle.left,
          checkboxX: checkbox.left,
          textX: text.left,
          gripGap: checkbox.left - grip.right,
          handleYOffset: Math.abs(handle.top + handle.height / 2 - firstLineCentre),
          checkboxYOffset: Math.abs(checkbox.top + checkbox.height / 2 - firstLineCentre),
          textHeight: text.height,
          lineHeight,
        };
      }),
    );

    expect(geometry).toHaveLength(2);
    expect(geometry[0].textHeight).toBeGreaterThan(geometry[0].lineHeight);
    expect(geometry[0].gripGap).toBeGreaterThanOrEqual(6);
    expect(geometry[0].handleYOffset).toBeLessThanOrEqual(1);
    expect(geometry[0].checkboxYOffset).toBeLessThanOrEqual(1);
    expect(geometry[0].handleX).toBeCloseTo(geometry[1].handleX, 0);
    expect(geometry[0].checkboxX).toBeCloseTo(geometry[1].checkboxX, 0);
    expect(geometry[0].textX).toBeCloseTo(geometry[1].textX, 0);
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

  test('task controls stay separated and taps toggle only their row', async ({ page }) => {
    await login(page);
    await openListNote(page, 'Touch tasks', '- [ ] First task\n- [ ] Second task\n');

    const first = page.locator('.ProseMirror li[data-item-type="task"]').first();
    const geometry = await first.evaluate((item) => {
      const editor = item.closest('.editor-container')!.getBoundingClientRect();
      const handle = item.querySelector('.list-drag-handle')!.getBoundingClientRect();
      const grip = item.querySelector('.list-drag-handle svg')!.getBoundingClientRect();
      const hit = item.querySelector('.task-check-hit')!.getBoundingClientRect();
      const checkbox = item.querySelector('.task-checkbox')!.getBoundingClientRect();
      const text = item.querySelector('.task-content p')!.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(item).lineHeight);
      const firstLineCentre = text.top + lineHeight / 2;
      return {
        handleVisible: Number(getComputedStyle(item.querySelector('.list-drag-handle')!).opacity),
        handleInsideEditor: handle.left >= editor.left,
        gripGap: checkbox.left - grip.right,
        targetGap: hit.left - handle.right,
        targetWidth: hit.width,
        targetHeight: hit.height,
        handleYOffset: Math.abs(handle.top + handle.height / 2 - firstLineCentre),
        checkboxYOffset: Math.abs(checkbox.top + checkbox.height / 2 - firstLineCentre),
      };
    });

    expect(geometry.handleVisible).toBeGreaterThan(0);
    expect(geometry.handleInsideEditor, JSON.stringify(geometry)).toBe(true);
    expect(geometry.gripGap).toBeGreaterThanOrEqual(6);
    expect(geometry.targetGap).toBeGreaterThanOrEqual(5);
    expect(geometry.targetWidth).toBeGreaterThanOrEqual(28);
    expect(geometry.targetHeight).toBeGreaterThanOrEqual(40);
    expect(geometry.handleYOffset).toBeLessThanOrEqual(1);
    expect(geometry.checkboxYOffset).toBeLessThanOrEqual(1);

    await page.locator('.task-check-hit').nth(1).click();
    await expect(page.locator('.ProseMirror li[data-checked="false"]')).toHaveCount(1);
    await expect(page.locator('.ProseMirror li[data-checked="true"]')).toHaveCount(1);
  });
});
