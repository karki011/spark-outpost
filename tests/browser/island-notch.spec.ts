import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { floatingBlob, ISLAND_WIDTH } from '../../apps/desktop/src/island-geometry.ts';
import { ISLAND_BLOB, islandTuck } from '../../packages/contracts/src/island-size.ts';
import {
  command,
  dragPhases,
  focusCalls,
  island,
  NOTCH,
  notchBox,
  openNotchIsland,
  restSize,
  scoutLook,
  settled,
  shownText,
  sparkFocus,
  underNotch,
  VIEWPORT,
} from './island-notch-desktop.ts';
import { seedChats } from './sidebar-seed.ts';
import { pointAtScout } from './island-pointer.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const SIZES = ['full', 'small', 'medium', 'large', 'xlarge'] as const;
const LONG = 'Rework the checkout flow so that abandoned carts are recovered by email reminders';
const LONG_COMMAND = 'pnpm deploy --prod --region eu-west-1 --tag release-candidate --confirm';
const REST_ROOM = { width: 150, height: 20 };
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

async function hover(page: Page) {
  await pointAtScout(page);
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

    await hover(page);
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
  test(`the resting blob peeks from under the notch strip with the window ${name}`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await openNotchIsland(page, { size: 'full', autoExpand: false, cutout: WIDE_NOTCH, windowTop });
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await expect(island(page)).toHaveClass(/\btucked\b/);
    const barBottom = Math.max(0, WIDE_NOTCH.menuBar - windowTop);
    const tuck = islandTuck(ISLAND_BLOB.full);
    await expect.poll(async () => (await scoutLook(page)).top).toBe(barBottom - tuck);
    const look = await scoutLook(page);
    expect(look.hidden).toBe(tuck);
    expect(look.eyesTop).toBeGreaterThan(barBottom);
    const drawn = (await island(page).boundingBox())!;
    expect(drawn.y + drawn.height).toBeLessThanOrEqual(barBottom + 1);
    await shot(page, name);
  });
}

const WINDOW_LEFT = (VIEWPORT.width - ISLAND_WIDTH) / 2;

for (const [name, notch, windowTop] of [
  ['under-notch', true, WIDE_NOTCH.height],
  ['flat-top', false, 0],
] as const) {
  test(`a floating island rests as the blob alone at the top of its window: ${name}`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    for (const size of ['small', 'full', 'xlarge'] as const) {
      const blob = floatingBlob(ISLAND_BLOB[size]);
      await openNotchIsland(page, {
        size,
        autoExpand: false,
        notch,
        cutout: WIDE_NOTCH,
        docked: false,
        windowTop,
        asScreen: true,
      });
      await expect(island(page)).toHaveAttribute('data-view', 'peek');
      await expect
        .poll(() => page.locator('.isl-scout-wrap').boundingBox())
        .toEqual({
          x: WINDOW_LEFT + blob.x,
          y: windowTop + blob.y,
          width: blob.size,
          height: blob.size,
        });
      await expect(island(page)).not.toHaveClass(/\btucked\b/);
      expect((await scoutLook(page)).hidden).toBe(0);
      expect((await island(page).boundingBox())!.height).toBeLessThanOrEqual(1);
    }
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(SHOTS || test.info().outputDir, `island-float-${name}.png`),
      clip: { x: 320, y: 0, width: 640, height: 200 },
    });
  });
}

test('the resting blob drags as a blob and a drag does not open the island', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'full', autoExpand: false, notch: false, docked: false });
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect.poll(() => scoutLook(page)).toMatchObject({ top: 0, size: ISLAND_BLOB.full });
  const blob = (await page.locator('.isl-scout-wrap').boundingBox())!;
  const at = { x: blob.x + blob.width / 2, y: blob.y + blob.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 12, at.y + 3, { steps: 3 });
  await page.mouse.up();
  const phases = await dragPhases(page);
  expect(phases.at(0)).toBe('lift');
  expect(phases.at(-1)).toBe('end');
  await page.mouse.move(at.x, 500);
  await staysOn(page, 'peek');

  await page.getByRole('button', { name: 'Open Spark Island' }).click();
  await page.mouse.move(at.x, 500);
  await staysOn(page, 'panel');
});

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
      await expect(island(page).locator('.isl-restline, .isl-nowbar, .isl-view')).toHaveCount(0);
      expect(await shownText(page)).toBe('');
      await settled(page);
      const drawn = (await island(page).boundingBox())!;
      if (notch) {
        expect(drawn.width).toBeLessThanOrEqual(NOTCH.width);
        expect(drawn.y + drawn.height).toBeLessThanOrEqual(NOTCH.menuBar);
        return;
      }
      const blob = ISLAND_BLOB[size];
      expect(drawn.width).toBeLessThanOrEqual(blob);
      await expect.poll(() => restSize(page)).not.toBeNull();
      const rest = (await restSize(page))!;
      expect(rest.width).toBeLessThanOrEqual(blob + REST_ROOM.width);
      expect(rest.height).toBeLessThanOrEqual(blob + REST_ROOM.height);
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
    await expect(island(page).locator('.isl-restline, .isl-nowbar')).toHaveCount(0);

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
    await expect(island(page).locator('.isl-aside')).toHaveText('1');
    await expect(island(page).locator('.isl-pbadge, .isl-restline')).toHaveCount(0);
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
  await hover(page);
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
