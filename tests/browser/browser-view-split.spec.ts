import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openBrowserView, pushView, viewCommands } from './browser-view-support.ts';
import { calls } from './desktop-browser.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, connected: ['claude'] });
});

const DOCS = { title: 'Docs', url: 'https://docs.example.com/', active: true };
const NEWS = { title: 'News', url: 'https://news.example.com/', active: false };
const SPLIT = { split: { leftTabId: 'v1', rightTabId: 'v2', ratio: 0.5 } };

const lastCommand = async (page: Page) => (await viewCommands(page)).at(-1)?.command;

test('Split view offers this profile’s other tabs and leaves both tabs', async ({ page }) => {
  await openBrowserView(page);
  await pushView(page, [DOCS, NEWS]);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Split view' }).click();
  const menu = page.getByRole('menu', { name: 'Show beside this tab' });
  await expect(menu.getByRole('menuitem')).toHaveText(['New tab', 'News']);
  await menu.getByRole('menuitem', { name: 'News' }).click();
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'split_with', tabId: 'v2' });

  await pushView(page, [DOCS, NEWS], [], 'personal', SPLIT);
  await expect(main.getByRole('region', { name: 'Docs' })).toBeVisible();
  await expect(main.getByRole('region', { name: 'News' })).toBeVisible();
  await expect(main.getByText('In use')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Browser' }).getByText('Split')).toHaveCount(2);
  await expect
    .poll(async () =>
      ((await calls(page, 'view-place-slot')) as { tabId: string }[]).map((slot) => slot.tabId),
    )
    .toEqual(expect.arrayContaining(['v1', 'v2']));
  expect(
    (await new AxeBuilder({ page }).include('.bv-split').analyze()).violations.map((v) => v.id),
  ).toEqual([]);

  await main.getByRole('button', { name: 'Close News' }).click();
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'close', tabId: 'v2' });
  await main.getByRole('button', { name: 'Leave split view' }).click();
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'split_leave' });
});

test('the divider resizes by keyboard and by drag, with no snapshot of the pages', async ({
  page,
}) => {
  await openBrowserView(page);
  await pushView(page, [DOCS, NEWS], [], 'personal', SPLIT);
  const divider = page.getByRole('separator', { name: 'Resize split view' });
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await divider.focus();
  await expect(divider).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'split_ratio', ratio: 0.48 });
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'split_ratio', ratio: 0.58 });
  await page.keyboard.press('Enter');
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'split_ratio', ratio: 0.5 });

  const before = (await calls(page, 'view-place-slot')).length;
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 95, box.y + 200, { steps: 6 });
  await expect
    .poll(async () => {
      const placed = await calls(page, 'view-place-slot');
      return placed.length > before;
    })
    .toBe(true);
  await page.mouse.up();
  const placed = (await calls(page, 'view-place-slot')) as { covered: boolean }[];
  expect(placed.slice(before).every((slot) => !slot.covered)).toBe(true);
  const last = (await lastCommand(page)) as { command: string; ratio: number };
  expect(last.command).toBe('split_ratio');
  expect(last.ratio).toBeLessThan(0.5);
});

test('Peek floats over the page, closes on Esc and opens as a tab', async ({ page }) => {
  await openBrowserView(page);
  const peek = { id: 'p1', title: 'Linked', url: 'https://link.example.com/', owner: 'user' };
  await pushView(page, [DOCS, NEWS], [], 'personal', {
    peek: {
      ...peek,
      active: false,
      place: 'local',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      pinned: false,
      kept: false,
      handoff: null,
      driving: false,
      picking: false,
      lastAction: null,
      error: null,
    },
  });
  const dialog = page.getByRole('dialog', { name: 'Peek: Linked' });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Browser' }).locator('input.bp-url'),
  ).toHaveValue(peek.url);
  await expect
    .poll(async () => ((await calls(page, 'view-place')) as { covered: boolean }[]).at(-1)?.covered)
    .toBe(true);
  await expect(page.getByRole('main').getByRole('button', { name: 'Split view' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'peek_close' });
  await dialog.getByRole('button', { name: 'Open as tab' }).click();
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'peek_promote' });
  await dialog.getByRole('button', { name: 'Close Peek' }).click();
  await expect.poll(() => lastCommand(page)).toEqual({ command: 'peek_close' });
});
