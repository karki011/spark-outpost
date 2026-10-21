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
import { HIT_MARGIN } from '../../apps/web/src/island/island-regions.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const SIZES = ['full', 'small', 'medium', 'large', 'xlarge'] as const;
const LONG = 'Rework the checkout flow so that abandoned carts are recovered by email reminders';
const LONG_COMMAND = 'pnpm deploy --prod --region eu-west-1 --tag release-candidate --confirm';
const BORDER = 2;
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

const count = (page: Page) => island(page).locator('.isl-pbadge');

async function scoutBelowNotch(page: Page) {
  const scout = (await page.locator('.isl-scout-wrap').boundingBox())!;
  expect(scout.y).toBeGreaterThanOrEqual(NOTCH.height);
}

async function openHomeFromScout(page: Page) {
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await island(page).locator('.isl-scout-btn').click();
  await expect(island(page).locator('[data-panel="home"]')).toBeVisible();
}

for (const size of SIZES) {
  test(`at ${size} size resting Scout and hovered content stay clear of the notch`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await seedChats([
      { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 },
      { title: 'Tidy the README', run: { status: 'succeeded' }, minutesAgo: 3 },
    ]);
    await openNotchIsland(page, { size, autoExpand: false });
    await staysOn(page, 'peek');
    expect(await underNotch(page)).toEqual([]);
    await scoutBelowNotch(page);
    await shot(page, `${size}-rest`);

    await seedChats([
      {
        title: LONG,
        run: { status: 'awaiting_approval' },
        approval: { kind: 'execute', title: 'Deploy', command: LONG_COMMAND },
      },
    ]);
    await expect(count(page)).toHaveText('1');
    await staysOn(page, 'peek');
    expect(await focusCalls(page)).not.toContain(true);
    expect(await underNotch(page)).toEqual([]);
    await shot(page, `${size}-needs-you`);

    await pointAtScout(page);
    const line = island(page).locator('.isl-hover');
    await expect(line).toContainText(LONG);
    await expect(line.getByRole('button', { name: 'Allow' })).toBeVisible();
    expect(await underNotch(page)).toEqual([]);

    await openHomeFromScout(page);
    const card = island(page).getByRole('article', { name: `${LONG} needs you` });
    await expect(card).toContainText(LONG_COMMAND);
    expect(await underNotch(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
    await page.waitForTimeout(800);
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
    test(`at ${size} size ${notch ? 'under a notch' : 'on a flat display'} one working chat rests as Scout alone, with no count, title or status line`, async ({
      page,
    }) => {
      await resetTestDatabase({ onboarded: true });
      await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
      await openNotchIsland(page, { size, autoExpand: true, notch });
      await staysOn(page, 'peek');
      await expect(island(page).locator('.isl-restline, .isl-hover, .isl-pbadge')).toHaveCount(0);
      expect(await shownText(page)).toBe('');
      await settled(page);
      const drawn = (await island(page).boundingBox())!;
      expect(drawn.y).toBe(0);
      expect(drawn.width).toBeLessThanOrEqual((notch ? NOTCH.width : ISLAND_BLOB[size]) + BORDER);
      if (notch) {
        expect(await underNotch(page)).toEqual([]);
        await scoutBelowNotch(page);
        return;
      }
      await expect.poll(() => restSize(page)).not.toBeNull();
      const rest = (await restSize(page))!;
      expect(rest.width).toBeGreaterThanOrEqual(drawn.width);
      expect(rest.width).toBeLessThanOrEqual(ISLAND_BLOB[size] + 2 * HIT_MARGIN + BORDER);
    });
  }
}

for (const size of ['full', 'large'] as const) {
  test(`at ${size} size a request opens once from rest, clear of the notch, without taking the keyboard`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
    await openNotchIsland(page, { size, autoExpand: true });
    await staysOn(page, 'peek');
    await expect(island(page).locator('.isl-restline, .isl-pbadge')).toHaveCount(0);

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
    await expect(
      island(page).getByRole('button', { name: 'Spark: 1 set aside. Open Spark Island' }),
    ).toBeAttached();
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
    await expect(count(page)).toHaveCount(0);
    expect(await focusCalls(page)).not.toContain(true);
  });
}

test('a request waits while Spark is focused or a panel is open, and Escape puts it away for good', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'medium', autoExpand: true, sparkFocused: true });
  await seedChats([deploy]);
  await expect(count(page)).toHaveText('1');
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

test('with the switch off a request stays a count on Scout until it is opened', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false });
  await seedChats([deploy]);
  await expect(count(page)).toHaveText('1');
  await staysOn(page, 'peek');
  expect(await focusCalls(page)).not.toContain(true);
  await command(page, 'quick');
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  await expect(island(page).getByRole('group', { name: /pnpm deploy/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
});

test('saved Full size rests as Scout alone on a display without a notch and opens Home from it', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
  await openNotchIsland(page, { size: 'full', autoExpand: true, notch: false });
  await staysOn(page, 'peek');
  await settled(page);
  const box = (await island(page).boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.width).toBeLessThanOrEqual(ISLAND_BLOB.full + BORDER);
  await shot(page, 'full-flat');
  await openHomeFromScout(page);
  const tiles = island(page).getByRole('region', { name: /^Working/ });
  await expect(tiles.getByRole('button', { name: /Fix billing totals/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
});

test.describe('screenshots', () => {
  test.use({ deviceScaleFactor: 2 });
  for (const theme of ['graphite', 'apricot']) {
    test(`shows resting Scout and a request opened by itself in ${theme}`, async ({ page }) => {
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
