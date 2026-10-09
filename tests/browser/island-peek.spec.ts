import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { ISLAND_BLOB, islandTuck } from '../../packages/contracts/src/island-size.ts';
import {
  island,
  openNotchIsland,
  scoutLook,
  settled,
  VIEWPORT,
  type NotchSetup,
} from './island-notch-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
const NOTCH = { width: 220, height: 38, menuBar: 44 };
const OUT_GAP = 4;
const deploy = {
  title: 'Deploy the site',
  run: { status: 'awaiting_approval' },
  approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
};

const open = (page: Page, setup: Partial<NotchSetup> & Pick<NotchSetup, 'size'>) =>
  openNotchIsland(page, { autoExpand: false, cutout: NOTCH, ...setup });

async function archive(chatId: string) {
  const db = openTestDb();
  try {
    await db.query(`UPDATE conversations SET archived_at = now() WHERE id = $1`, [chatId]);
  } finally {
    await db.end();
  }
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(SHOTS, `island-peek-${name}.png`),
    clip: { x: 340, y: 0, width: 600, height: 240 },
  });
}

async function tuckedUnder(page: Page, size: (typeof SIZES)[number], edge: number) {
  const blob = ISLAND_BLOB[size];
  const tuck = islandTuck(blob);
  await expect(island(page)).toHaveClass(/\btucked\b/);
  await expect.poll(() => scoutLook(page)).toMatchObject({ top: edge - tuck, size: blob });
  const look = await scoutLook(page);
  expect(look.hidden).toBe(tuck);
  expect((look.bottom - edge) / blob).toBeGreaterThan(0.44);
  expect((look.bottom - edge) / blob).toBeLessThan(0.5);
  expect(look.eyesTop).toBeGreaterThan(edge);
}

async function fullyOut(page: Page, size: (typeof SIZES)[number], edge: number) {
  await expect(island(page)).not.toHaveClass(/\btucked\b/);
  await expect
    .poll(() => scoutLook(page))
    .toMatchObject({ top: edge + OUT_GAP, size: ISLAND_BLOB[size], hidden: 0 });
}

for (const notch of [true, false]) {
  const edge = notch ? NOTCH.menuBar : 0;
  const where = notch ? 'under a 220x38 notch' : 'at the top edge of a flat display';
  for (const size of SIZES) {
    test(`at ${size} size the resting blob shows its lower half ${where}, comes out when a chat needs you and tucks back`, async ({
      page,
    }) => {
      await resetTestDatabase({ onboarded: true });
      await open(page, { size, notch });
      await expect(island(page)).toHaveAttribute('data-view', 'peek');
      await tuckedUnder(page, size, edge);
      const centre = (await island(page).locator('.isl-scout-wrap').boundingBox())!;
      expect(centre.x + centre.width / 2).toBe(VIEWPORT.width / 2);
      await shot(page, `${notch ? 'notch' : 'flat'}-${size}-rest`);

      const [chat] = await seedChats([deploy]);
      await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
      await expect(island(page)).toHaveAttribute('data-view', 'peek');
      await fullyOut(page, size, edge);
      await shot(page, `${notch ? 'notch' : 'flat'}-${size}-needs-you`);

      await archive(chat!);
      await expect(island(page).locator('.isl-pbadge')).toHaveCount(0);
      await tuckedUnder(page, size, edge);
    });
  }

  test(`hovering the tucked blob ${where} brings it fully out with the panel`, async ({ page }) => {
    await resetTestDatabase({ onboarded: true });
    await open(page, { size: 'xlarge', notch });
    await tuckedUnder(page, 'xlarge', edge);
    await page.mouse.move(640, 300);
    await page.mouse.move(640, edge + 30, { steps: 4 });
    await expect(island(page)).toHaveAttribute('data-view', 'panel');
    await settled(page);
    const look = await scoutLook(page);
    expect(look.hidden).toBe(0);
    expect(look.top).toBeGreaterThanOrEqual(0);
    const panel = (await island(page).boundingBox())!;
    expect(look.bottom).toBeLessThanOrEqual(panel.y + panel.height);
    await shot(page, `${notch ? 'notch' : 'flat'}-xlarge-hover`);
    await page.mouse.move(5, 600);
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await tuckedUnder(page, 'xlarge', edge);
  });
}

test('a working chat keeps the blob out and a floating island is never tucked', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
  await open(page, { size: 'large' });
  await expect(island(page).locator('.isl-scout-wrap svg.scout')).toHaveClass(/\bworking\b/);
  await fullyOut(page, 'large', NOTCH.menuBar);

  await resetTestDatabase({ onboarded: true });
  await open(page, { size: 'xlarge', docked: false });
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(island(page)).not.toHaveClass(/\btucked\b/);
  await expect
    .poll(() => scoutLook(page))
    .toMatchObject({ top: 0, hidden: 0, size: ISLAND_BLOB.xlarge });
  await shot(page, 'floating-xlarge');
});

test('with reduced motion the blob is out or tucked at once, with no slide', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetTestDatabase({ onboarded: true });
  await open(page, { size: 'xlarge' });
  await tuckedUnder(page, 'xlarge', NOTCH.menuBar);
  await seedChats([deploy]);
  await expect(island(page)).not.toHaveClass(/\btucked\b/);
  expect((await scoutLook(page)).top).toBe(NOTCH.menuBar + OUT_GAP);
  expect(
    await island(page)
      .locator('.isl-scout-wrap .sc-look')
      .evaluate((look) => getComputedStyle(look).transitionDuration),
  ).toBe('0s');
});

test.describe('screenshots', () => {
  test.use({ deviceScaleFactor: 2 });
  for (const theme of ['graphite', 'apricot']) {
    for (const size of ['large', 'xlarge'] as const) {
      for (const notch of [true, false]) {
        const where = notch ? 'notch' : 'flat';
        test(`shows ${size} on ${where} at rest and needing you in ${theme}`, async ({ page }) => {
          test.skip(!SHOTS, 'screenshots only');
          await resetTestDatabase({ onboarded: true });
          await open(page, { size, notch, theme });
          await tuckedUnder(page, size, notch ? NOTCH.menuBar : 0);
          await shot(page, `${theme}-${where}-${size}-rest`);
          await seedChats([deploy]);
          await fullyOut(page, size, notch ? NOTCH.menuBar : 0);
          await shot(page, `${theme}-${where}-${size}-needs-you`);
        });
      }
      test(`shows ${size} floating in ${theme}`, async ({ page }) => {
        test.skip(!SHOTS, 'screenshots only');
        await resetTestDatabase({ onboarded: true });
        await open(page, { size, notch: false, docked: false, theme });
        await expect.poll(async () => (await scoutLook(page)).top).toBe(0);
        await shot(page, `${theme}-floating-${size}`);
      });
    }
  }
});
