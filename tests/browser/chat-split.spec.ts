import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { animationsSettled } from './settle.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.SPARK_SPLIT_SHOTS;
const LEFT = 'Plan the launch';
const RIGHT = 'Fix the login';

let ids: string[] = [];

test.beforeEach(async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  ids = await seedChats([
    { title: LEFT },
    { title: RIGHT, run: { status: 'succeeded' }, unread: true },
    { title: 'Write the notes' },
  ]);
  await page.setViewportSize({ width: 1440, height: 900 });
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Chats' });
const row = (page: Page, title: string) =>
  sidebar(page).getByRole('listitem').filter({ hasText: title });
const rowButton = (page: Page, title: string) => row(page, title).locator('.row-open');
const left = (page: Page) => page.getByRole('main');
const right = (page: Page) => page.getByRole('region', { name: /^Right chat: / });
const composer = (pane: ReturnType<typeof left>) => pane.getByRole('textbox', { name: 'Message' });
const pane = (page: Page, side: 'primary' | 'secondary') =>
  page.locator(`.cpane[data-side="${side}"]`);
const divider = (page: Page) => page.getByRole('separator', { name: 'Resize chats' });

async function openInSplitFromMenu(page: Page, title: string) {
  await row(page, title).hover();
  await sidebar(page)
    .getByRole('button', { name: `Options for ${title}` })
    .click();
  await page
    .getByRole('menu', { name: `Options for ${title}` })
    .getByRole('menuitem', { name: 'Open in split' })
    .click();
}

async function dimmed(page: Page, side: 'primary' | 'secondary') {
  return pane(page, side).evaluate((element) => getComputedStyle(element, '::after').opacity);
}

async function runOf(conversationId: string): Promise<string> {
  const db = openTestDb();
  try {
    const result = await db.query<{ id: string }>(
      'SELECT id FROM runs WHERE conversation_id = $1',
      [conversationId],
    );
    return result.rows[0]!.id;
  } finally {
    await db.end();
  }
}

test('Open in split shows a second chat beside the first, reads it and highlights both', async ({
  page,
}) => {
  await openChats(page);
  await expect(left(page).getByRole('heading', { level: 1 })).toHaveText(LEFT);
  const read = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().endsWith(`/attention/chats/${ids[1]}/read`),
  );
  await openInSplitFromMenu(page, RIGHT);

  await expect(right(page)).toHaveAccessibleName(`Right chat: ${RIGHT}, focused`);
  await expect(left(page)).toHaveAccessibleName(`Left chat: ${LEFT}`);
  await expect(right(page).getByRole('heading', { level: 1 })).toHaveText(RIGHT);
  await read;
  await expect(rowButton(page, LEFT)).toHaveAttribute('aria-current', 'page');
  await expect(rowButton(page, RIGHT)).toHaveAttribute('aria-current', 'page');
  await expect(rowButton(page, 'Write the notes')).not.toHaveAttribute('aria-current', 'page');

  await row(page, RIGHT).hover();
  await sidebar(page)
    .getByRole('button', { name: `Options for ${RIGHT}` })
    .click();
  const menu = page.getByRole('menu', { name: `Options for ${RIGHT}` });
  await expect(menu.getByRole('menuitem', { name: 'Open in split' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const results = await new AxeBuilder({ page }).include('.cpanes').analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test('Option-click and Option-Enter open in split, and the close button leaves it', async ({
  page,
}) => {
  await openChats(page);
  await rowButton(page, RIGHT).click({ modifiers: ['Alt'] });
  await expect(right(page).getByRole('heading', { level: 1 })).toHaveText(RIGHT);

  await right(page).getByRole('button', { name: 'Close right chat' }).click();
  await expect(right(page)).toHaveCount(0);
  await expect(divider(page)).toHaveCount(0);
  await expect(composer(left(page))).toBeFocused();
  await expect(left(page)).not.toHaveAttribute('aria-label');
  await expect(rowButton(page, RIGHT)).not.toHaveAttribute('aria-current', 'page');

  await rowButton(page, 'Write the notes').focus();
  await page.keyboard.press('Alt+Enter');
  await expect(right(page).getByRole('heading', { level: 1 })).toHaveText('Write the notes');
  await expect(left(page).getByRole('heading', { level: 1 })).toHaveText(LEFT);
});

test('clicking or typing in a pane focuses it, the other dims and stays answerable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openChats(page);
  await rowButton(page, RIGHT).click({ modifiers: ['Alt'] });
  await expect(right(page)).toHaveAccessibleName(/, focused$/);
  await expect.poll(() => dimmed(page, 'primary')).toBe('1');
  await expect.poll(() => dimmed(page, 'secondary')).toBe('0');

  await composer(left(page)).click();
  await expect(left(page)).toHaveAccessibleName(`Left chat: ${LEFT}, focused`);
  await expect(right(page)).toHaveAccessibleName(`Right chat: ${RIGHT}`);
  await expect.poll(() => dimmed(page, 'secondary')).toBe('1');

  const input = composer(right(page));
  const box = (await input.boundingBox())!;
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('.cpane')?.getAttribute('data-side'),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hit).toBe('secondary');

  await page.keyboard.press('Shift+Tab');
  await input.focus();
  await page.keyboard.type('still here');
  await expect(right(page)).toHaveAccessibleName(/, focused$/);
  await expect(input).toHaveValue('still here');

  await rowButton(page, 'Write the notes').click();
  await expect(right(page).getByRole('heading', { level: 1 })).toHaveText('Write the notes');
  await expect(left(page).getByRole('heading', { level: 1 })).toHaveText(LEFT);

  await rowButton(page, LEFT).click();
  await expect(left(page)).toHaveAccessibleName(/, focused$/);
  await expect(right(page).getByRole('heading', { level: 1 })).toHaveText('Write the notes');
});

test('the changes shortcut opens the drawer for the focused pane only', async ({ page }) => {
  await openChats(page);
  await rowButton(page, RIGHT).click({ modifiers: ['Alt'] });
  const drawer = page.getByRole('dialog', { name: 'Changes', exact: true });

  await composer(right(page)).focus();
  await page.keyboard.press('ControlOrMeta+D');
  await expect(drawer).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(composer(right(page))).toBeFocused();

  await composer(left(page)).focus();
  await page.keyboard.press('ControlOrMeta+D');
  await expect(drawer).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(composer(left(page))).toBeFocused();
});

test('Esc stops only the focused pane’s turn', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  ids = await seedChats([
    { title: LEFT, run: { status: 'running' } },
    { title: RIGHT, run: { status: 'running' } },
  ]);
  const leftRun = await runOf(ids[0]!);
  const rightRun = await runOf(ids[1]!);
  const cancels: string[] = [];
  page.on('request', (request) => {
    const match = /\/runs\/([^/]+)\/cancel$/.exec(new URL(request.url()).pathname);
    if (match) cancels.push(match[1]!);
  });
  await openChats(page);
  await rowButton(page, RIGHT).click({ modifiers: ['Alt'] });
  await expect(right(page).getByRole('heading', { level: 1 })).toHaveText(RIGHT);

  await composer(right(page)).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => cancels).toEqual([rightRun]);
  expect(cancels).not.toContain(leftRun);
});

test('the pair, focus and divider come back after a reload, and narrow windows show one chat', async ({
  page,
}) => {
  await openChats(page);
  await rowButton(page, RIGHT).click({ modifiers: ['Alt'] });
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '50');
  await divider(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '46');
  await composer(right(page)).focus();

  await page.reload();
  await expect(left(page).getByRole('heading', { level: 1 })).toHaveText(LEFT);
  await expect(right(page).getByRole('heading', { level: 1 })).toHaveText(RIGHT);
  await expect(right(page)).toHaveAccessibleName(/, focused$/);
  await expect(divider(page)).toHaveAttribute('aria-valuenow', '46');
  const leftWidth = (await pane(page, 'primary').boundingBox())!.width;
  const rightWidth = (await pane(page, 'secondary').boundingBox())!.width;
  expect(leftWidth).toBeLessThan(rightWidth);

  await page.setViewportSize({ width: 820, height: 900 });
  await expect(right(page)).toHaveCount(0);
  await expect(left(page).getByRole('heading', { level: 1 })).toHaveText(LEFT);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(right(page).getByRole('heading', { level: 1 })).toHaveText(RIGHT);

  if (!SHOTS) return;
  await composer(left(page)).click();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await animationsSettled(page);
    await page.screenshot({ path: `${SHOTS}/split-chat-${colorScheme}.png` });
  }
});
