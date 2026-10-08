import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import {
  command,
  focusCalls,
  island,
  notchBox,
  openNotchIsland,
  settled,
  sparkFocus,
  underNotch,
} from './island-notch-desktop.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';
const SIZES = ['full', 'small', 'medium', 'large'] as const;
const LONG = 'Rework the checkout flow so that abandoned carts are recovered by email reminders';
const LONG_COMMAND = 'pnpm deploy --prod --region eu-west-1 --tag release-candidate --confirm';
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
    await openNotchIsland(page, { size, autoExpand: true });
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

for (const size of ['full', 'large'] as const) {
  test(`saved auto-expand at ${size} stays collapsed until the review shortcut`, async ({
    page,
  }) => {
    await resetTestDatabase({ onboarded: true });
    await openNotchIsland(page, { size, autoExpand: true });
    await seedChats([deploy]);
    await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
    await staysOn(page, 'peek');
    expect(await focusCalls(page)).not.toContain(true);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    await command(page, 'quick');
    await expect(island(page)).toHaveAttribute('data-view', 'card');
    const card = island(page).getByRole('group', { name: /pnpm deploy/ });
    await expect(card).toBeFocused();
    await expect(card.getByRole('button', { name: /Allow once/ })).toBeVisible();
    expect(await underNotch(page)).toEqual([]);
    expect((await island(page).locator('.isl-card').boundingBox())!.y).toBeGreaterThanOrEqual(
      notchBox().bottom,
    );
    await shot(page, `${size}-request`);
    await page.keyboard.press('Escape');
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await sparkFocus(page, true);
    await sparkFocus(page, false);
    await staysOn(page, 'peek');
  });
}

test('a pending request keeps an explicit panel open and Escape collapses it', async ({ page }) => {
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
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await staysOn(page, 'peek');
});

test('with a saved disabled auto-expand setting, a request still stays collapsed', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false });
  await seedChats([deploy]);
  await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
  await staysOn(page, 'peek');
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
    test(`shows the resting blobs and a hovered request in ${theme}`, async ({ page }) => {
      test.skip(!SHOTS, 'screenshots only');
      await resetTestDatabase({ onboarded: true });
      await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 }]);
      await openNotchIsland(page, { size: 'full', autoExpand: true, theme });
      await expect(island(page)).toHaveAttribute('data-view', 'peek');
      await shot(page, `${theme}-full`);
      await seedChats([deploy]);
      await expect(island(page).locator('.isl-pbadge')).toHaveText('1');
      await hover(page, 40);
      await shot(page, `${theme}-request`);
    });
  }
});
