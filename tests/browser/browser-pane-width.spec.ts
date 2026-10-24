import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { calls, withDesktopBrowser } from './desktop-browser.ts';
import { toggleHeaderPane } from './header-menu.ts';
import { openChats } from './navigation.ts';

interface Placement {
  bounds: { x: number; y: number; width: number; height: number } | null;
  covered: boolean;
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

async function openPane(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await withDesktopBrowser(page);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await toggleHeaderPane(page, 'Browser');
  const pane = page.getByRole('region', { name: 'Browser' });
  await expect(pane).toBeVisible();
  const started = (await calls(page, 'start')) as { chatId: string }[];
  await page.evaluate((chat) => {
    (window as unknown as { browserPush: (id: string, tabs: unknown[]) => void }).browserPush(
      chat,
      [{ title: 'Site', url: 'http://localhost:5173/', active: true }],
    );
  }, started[0]!.chatId);
  await expect(pane.getByRole('tab', { name: 'Site', exact: true })).toBeVisible();
  await settled(page);
  return pane;
}

async function settled(page: Page): Promise<void> {
  await expect
    .poll(async () => (await lastBounds(page))?.width === (await pageWidth(page)))
    .toBe(true);
}

async function hideSidebar(page: Page): Promise<void> {
  const handle = page.getByRole('separator', { name: 'Resize browser pane' });
  const before = await handle.getAttribute('aria-valuemax');
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await expect(handle).not.toHaveAttribute('aria-valuemax', before!);
  await page.waitForTimeout(400);
}

async function lastBounds(page: Page): Promise<Placement['bounds']> {
  const placed = (await calls(page, 'place')) as Placement[];
  const shown = placed.filter((placement) => placement.bounds !== null && !placement.covered);
  return shown.at(-1)?.bounds ?? null;
}

async function pageWidth(page: Page): Promise<number> {
  return page
    .locator('#bp-view')
    .evaluate((view) => Math.round(view.getBoundingClientRect().width));
}

async function chatWidth(page: Page): Promise<number> {
  return page
    .locator('main.main')
    .evaluate((main) => Math.round(main.getBoundingClientRect().width));
}

async function dragBy(page: Page, handle: Locator, dx: number): Promise<void> {
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 3 + dx, y, { steps: 8 });
  await expect(page.locator('.bp-width')).toBeVisible();
  await page.mouse.up();
}

test('the browser pane drags from a 320 px page to nearly the whole window', async ({ page }) => {
  await openPane(page);
  await hideSidebar(page);
  const handle = page.getByRole('separator', { name: 'Resize browser pane' });
  await expect(handle).toHaveAttribute('aria-valuemin', '320');

  await dragBy(page, handle, 1400);
  await expect.poll(() => pageWidth(page)).toBe(320);
  await expect(page.locator('.bp-width')).toHaveText('320 px');
  await expect(handle).toHaveAttribute('aria-valuenow', '320');
  await expect.poll(() => lastBounds(page).then((bounds) => bounds?.width)).toBe(320);

  await dragBy(page, handle, -1400);
  await expect.poll(() => chatWidth(page)).toBe(300);
  const widest = await pageWidth(page);
  expect(widest).toBeGreaterThan(900);
  await expect(page.locator('.bp-width')).toHaveText(`${widest} px`);
  await expect(handle).toHaveAttribute('aria-valuemax', String(widest));
  await expect.poll(() => lastBounds(page).then((bounds) => bounds?.width)).toBe(widest);
  const bounds = (await lastBounds(page))!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440);
  await expect(page.locator('.bp-width')).toBeHidden({ timeout: 3000 });

  await page.reload();
  await expect.poll(() => pageWidth(page)).toBe(widest);
});

test('arrow keys step the page width by 10 px and by 50 px with Shift', async ({ page }) => {
  await openPane(page);
  const handle = page.getByRole('separator', { name: 'Resize browser pane' });
  await handle.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => pageWidth(page)).toBe(320);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => pageWidth(page)).toBe(330);
  await expect(page.locator('.bp-width')).toHaveText('330 px');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => pageWidth(page)).toBe(380);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => pageWidth(page)).toBe(370);
  await expect(handle).toHaveAttribute('aria-valuenow', '370');
  await expect(handle).toHaveAttribute('aria-valuetext', /^Page 370 pixels wide/);
  await expect.poll(() => lastBounds(page).then((bounds) => bounds?.width)).toBe(370);
  await page.keyboard.press('End');
  await expect.poll(() => chatWidth(page)).toBe(300);
});

test('page width presets size the page and say when the window is too narrow', async ({ page }) => {
  const pane = await openPane(page);
  await hideSidebar(page);
  const choose = async (name: string) => {
    await pane.getByRole('button', { name: 'Page width' }).click();
    await page.getByRole('menuitemradio', { name }).click();
  };
  for (const width of [390, 768, 1024]) {
    await choose(`${width} px`);
    await expect.poll(() => pageWidth(page)).toBe(width);
    await expect.poll(() => lastBounds(page).then((bounds) => bounds?.width)).toBe(width);
  }
  await pane.getByRole('button', { name: 'Page width' }).click();
  await expect(page.getByRole('menuitemradio', { name: '1024 px' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('menuitemradio', { name: '1280 px' })).toBeDisabled();
  await page.getByRole('menuitemradio', { name: /^Fit/ }).click();
  await expect.poll(() => chatWidth(page)).toBe(300);

  await page.setViewportSize({ width: 1300, height: 900 });
  await expect
    .poll(async () => {
      const last = await lastBounds(page);
      return last ? last.x + last.width : 0;
    })
    .toBeLessThanOrEqual(1300);
  await expect.poll(() => chatWidth(page)).toBeGreaterThanOrEqual(300);
});

test('the pane follows the sidebar and stays on screen', async ({ page }) => {
  await openPane(page);
  await hideSidebar(page);
  const handle = page.getByRole('separator', { name: 'Resize browser pane' });
  await handle.focus();
  await page.keyboard.press('End');
  await expect.poll(() => chatWidth(page)).toBe(300);
  const before = await pageWidth(page);
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect.poll(() => pageWidth(page)).toBeLessThan(before);
  await expect.poll(() => chatWidth(page)).toBeGreaterThanOrEqual(300);
  await expect
    .poll(async () => {
      const last = await lastBounds(page);
      return last ? last.x + last.width <= 1440 && last.width === (await pageWidth(page)) : false;
    })
    .toBe(true);
});

test('a narrow window still resizes the pane over the chat', async ({ page }) => {
  await openPane(page);
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.locator('#work-panel.over')).toBeVisible();
  const handle = page.getByRole('separator', { name: 'Resize browser pane' });
  await handle.focus();
  await page.keyboard.press('End');
  await expect
    .poll(async () => {
      const last = await lastBounds(page);
      return last ? last.x + last.width : 0;
    })
    .toBeLessThanOrEqual(1000);
  const widest = await pageWidth(page);
  expect(widest).toBeGreaterThan(900);
  await page.keyboard.press('Home');
  await expect.poll(() => pageWidth(page)).toBe(320);
  await expect.poll(() => lastBounds(page).then((bounds) => bounds?.width)).toBe(320);
});
