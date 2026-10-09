import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import {
  command,
  focusCalls,
  island,
  NOTCH,
  notchBox,
  openNotchIsland,
  restSize,
  settled,
  shownText,
  sparkFocus,
  underNotch,
} from './island-notch-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const SIZES = ['full', 'small', 'medium', 'large'] as const;
const LONG = 'Rework the checkout flow so that abandoned carts are recovered by email reminders';
const LONG_COMMAND = 'pnpm deploy --prod --region eu-west-1 --tag release-candidate --confirm';
const REST_MAX = { width: 200, height: 60 };
const deploy = {
  title: 'Deploy the site',
  run: { status: 'awaiting_approval' },
  approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
};

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(SHOTS, `island-notch-${name}.png`),
    clip: { x: 320, y: 0, width: 640, height: 300 },
  });
}

async function sql(text: string, chatId: string) {
  const db = openTestDb();
  try {
    await db.query(text, [chatId]);
  } finally {
    await db.end();
  }
}

const touch = (chatId: string) =>
  sql(`UPDATE conversations SET updated_at = now() + interval '1 minute' WHERE id = $1`, chatId);

const finish = (chatId: string) =>
  sql(
    `UPDATE runs SET status = 'succeeded', finished_at = now() WHERE conversation_id = $1`,
    chatId,
  );

async function staysOn(page: Page, view: string) {
  await page.waitForTimeout(1500);
  await expect(island(page)).toHaveAttribute('data-view', view);
}

async function hover(page: Page, y: number) {
  await page.mouse.move(640, 300);
  await page.mouse.move(640, y, { steps: 4 });
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
}

for (const size of SIZES) {
  test(`at ${size} size resting blobs and hovered content stay clear of the notch`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await seedChats([
      { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 },
      { title: 'Tidy the README', run: { status: 'succeeded' }, minutesAgo: 3 },
    ]);
    await openNotchIsland(page, { size, autoExpand: false });
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await expect(page.getByRole('button', { name: /^Chat: /, disabled: false })).toHaveCount(2);
    expect(await underNotch(page)).toEqual([]);
    await shot(page, `${size}-rest`);

    await seedChats([
      {
        title: LONG,
        run: { status: 'awaiting_approval' },
        approval: { kind: 'execute', title: 'Deploy', command: LONG_COMMAND },
      },
    ]);
    await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
    await staysOn(page, 'peek');
    expect(await focusCalls(page)).not.toContain(true);
    expect(await underNotch(page)).toEqual([]);
    await shot(page, `${size}-needs-you`);

    await hover(page, 40);
    const waiting = island(page).getByRole('group', { name: 'Waiting for you' });
    await expect(waiting).toContainText(LONG_COMMAND);
    expect(await underNotch(page)).toEqual([]);
    await page.mouse.move(5, 600);
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
  });
}

const WIDE_NOTCH = { width: 220, height: 38, menuBar: 44 };

for (const [name, windowTop] of [
  ['top', 0],
  ['lowered', 38],
  ['lowered-by-the-menu-bar', 44],
] as const) {
  test(`the resting blob sits 4 points under the notch with the window ${name}`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await openNotchIsland(page, { size: 'full', autoExpand: false, cutout: WIDE_NOTCH, windowTop });
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    const notchBottom = Math.max(0, WIDE_NOTCH.height - windowTop);
    const blob = page.locator('.isl-scout-wrap');
    await expect.poll(async () => (await blob.boundingBox())?.y).toBeCloseTo(notchBottom + 4, 0);
    const drawn = (await island(page).boundingBox())!;
    const barBottom = Math.max(0, WIDE_NOTCH.menuBar - windowTop);
    expect(drawn.y + drawn.height).toBeLessThanOrEqual(barBottom + 1);
    await shot(page, name);
  });
}

for (const size of SIZES) {
  for (const notch of [true, false]) {
    test(`at ${size} size ${notch ? 'under a notch' : 'on a flat display'} one working chat rests as blobs alone, with no title, status line or row`, async ({
      page,
    }) => {
      await resetTestDatabase({ onboarded: true });
      await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
      await openNotchIsland(page, { size, autoExpand: true, notch });
      await expect(page.getByRole('button', { name: /^Chat: Fix billing totals/ })).toBeVisible();
      await staysOn(page, 'peek');
      await expect(island(page).locator('.isl-nudge, .isl-nowbar, .isl-view')).toHaveCount(0);
      expect(await shownText(page)).toBe('');
      await settled(page);
      const drawn = (await island(page).boundingBox())!;
      if (notch) {
        expect(drawn.width).toBeLessThanOrEqual(NOTCH.width);
        expect(drawn.y + drawn.height).toBeLessThanOrEqual(NOTCH.menuBar);
        return;
      }
      expect(drawn.width).toBeLessThanOrEqual(REST_MAX.width);
      await expect.poll(() => restSize(page)).not.toBeNull();
      const rest = (await restSize(page))!;
      expect(rest.width).toBeLessThanOrEqual(REST_MAX.width);
      expect(rest.height).toBeLessThanOrEqual(REST_MAX.height);
    });
  }
}

for (const size of ['full', 'large'] as const) {
  test(`at ${size} size a request opens once from the blobs, clear of the notch, without taking the keyboard`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
    await openNotchIsland(page, { size, autoExpand: true });
    await staysOn(page, 'peek');
    await expect(island(page).locator('.isl-nudge, .isl-nowbar')).toHaveCount(0);

    const [first] = await seedChats([deploy]);
    await expect(island(page)).toHaveAttribute('data-view', 'card');
    await expect(island(page).getByRole('button', { name: /Allow once/ })).toBeVisible();
    await expect(island(page)).toContainText('pnpm deploy');
    expect(await underNotch(page)).toEqual([]);
    const card = (await island(page).locator('.isl-card').boundingBox())!;
    expect(card.y).toBeGreaterThanOrEqual(notchBox().bottom);
    expect(await focusCalls(page)).not.toContain(true);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await shot(page, `${size}-request`);

    await island(page).getByRole('button', { name: 'Later' }).click();
    await page.mouse.move(5, 600);
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
    await touch(first!);
    await staysOn(page, 'peek');
    await sparkFocus(page, true);
    await sparkFocus(page, false);
    await staysOn(page, 'peek');

    const [second] = await seedChats([
      {
        title: 'Speed up the test suite',
        run: { status: 'awaiting_approval' },
        approval: { kind: 'execute', title: 'npm test', command: 'npm test' },
      },
    ]);
    await expect(island(page)).toHaveAttribute('data-view', 'card');
    await expect(island(page)).toContainText('npm test');
    const allow = island(page).getByRole('button', { name: /Allow once/ });
    await expect(allow).toBeEnabled();
    await allow.click();
    await expect(island(page)).toContainText('Allowed once');
    await finish(second!);
    await page.mouse.move(5, 600);
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await staysOn(page, 'peek');
    expect(await focusCalls(page)).not.toContain(true);
  });
}

test('a request waits while Spark is focused or a panel is open, and Escape puts it away for good', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'medium', autoExpand: true, sparkFocused: true });
  await seedChats([deploy]);
  await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
  await staysOn(page, 'peek');
  await command(page, 'sessions');
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await sparkFocus(page, false);
  await staysOn(page, 'panel');
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', 'card');

  await command(page, 'quick');
  await expect.poll(() => focusCalls(page)).toContain(true);
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  expect(await underNotch(page)).toEqual([]);
  await staysOn(page, 'peek');
});

test('with the switch off a request stays as blobs until it is opened', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false });
  await seedChats([deploy]);
  await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
  await staysOn(page, 'peek');
  expect(await focusCalls(page)).not.toContain(true);
  await command(page, 'quick');
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  await expect(island(page).getByRole('group', { name: /pnpm deploy/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
});

test('saved Full size shows blobs on a display without a notch and opens Home on hover', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
  await openNotchIsland(page, { size: 'full', autoExpand: true, notch: false });
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(page.getByRole('button', { name: /^Chat: Fix billing totals/ })).toBeVisible();
  await settled(page);
  const box = (await island(page).boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.width).toBeLessThanOrEqual(420);
  expect(box.height).toBeLessThanOrEqual(90);
  await shot(page, 'full-flat');
  await hover(page, 8);
  await expect(island(page).getByRole('tab', { name: 'Home' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
});

test.describe('screenshots', () => {
  test.use({ deviceScaleFactor: 2 });
  for (const theme of ['graphite', 'apricot']) {
    test(`shows the resting blobs and a request opened by itself in ${theme}`, async ({ page }) => {
      test.skip(!SHOTS, 'screenshots only');
      await resetTestDatabase({ onboarded: true });
      await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
      await openNotchIsland(page, { size: 'full', autoExpand: true, theme });
      await expect(island(page)).toHaveAttribute('data-view', 'peek');
      await shot(page, `${theme}-full`);
      await seedChats([deploy]);
      await expect(island(page)).toHaveAttribute('data-view', 'card');
      await expect(island(page).getByRole('button', { name: /Allow once/ })).toBeVisible();
      await settled(page);
      await shot(page, `${theme}-request`);
    });
  }
});
