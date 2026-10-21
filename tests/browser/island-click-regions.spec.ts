import { expect, test, type Page } from '@playwright/test';
import { hitsIsland } from '../../packages/contracts/src/island-hit.ts';
import { resetTestDatabase } from './database.ts';
import {
  island,
  latestRegions,
  openNotchIsland,
  restSize,
  VIEWPORT,
} from './island-notch-desktop.ts';
import { pointAtScout, stillScout } from './island-pointer.ts';
import { seedChats } from './sidebar-seed.ts';

const REST_DELAY_MS = 700;
const PASSING_MS = 250;
const install = {
  title: 'Add the image library',
  run: { status: 'awaiting_approval' },
  approval: { kind: 'execute', title: 'npm install sharp', command: 'npm install sharp' },
};

const count = (page: Page) => island(page).locator('.isl-pbadge');

async function takesPointerAt(page: Page, x: number, y: number): Promise<boolean> {
  const regions = await latestRegions(page);
  return regions !== null && hitsIsland(regions, x, y);
}

test('resting Scout takes the click when a request appears, and the island stays compact', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  await expect.poll(() => restSize(page)).not.toBeNull();
  const before = (await restSize(page))!;
  await seedChats([install]);
  await expect(count(page)).toHaveText('1');
  await expect(island(page)).toHaveAttribute('data-view', 'peek');

  const scout = await stillScout(page);
  const box = (await page.locator('.isl-scout-wrap').boundingBox())!;
  await expect.poll(() => takesPointerAt(page, scout.x, scout.y)).toBe(true);
  expect(await takesPointerAt(page, box.x + box.width + 24, scout.y)).toBe(false);
  expect(await takesPointerAt(page, box.x - 24, scout.y)).toBe(false);
  expect((await restSize(page))!.width).toBeLessThanOrEqual(before.width + 1);

  await island(page).locator('.isl-scout-btn').click();
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect(
    island(page).getByRole('article', { name: 'Add the image library needs you' }),
  ).toBeVisible();
});

test('the open island takes the pointer over itself and its margin, and the rest stays clear', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  await pointAtScout(page);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  const box = (await island(page).boundingBox())!;
  await expect.poll(() => takesPointerAt(page, box.x + box.width / 2, box.y + 40)).toBe(true);
  expect(await takesPointerAt(page, box.x + box.width + 8, box.y + 40)).toBe(true);
  expect(await takesPointerAt(page, 5, VIEWPORT.height - 5)).toBe(false);
  expect(await takesPointerAt(page, VIEWPORT.width - 5, VIEWPORT.height - 5)).toBe(false);
});

test('crossing the notch toward the menu items never opens the island; resting on it does, and a click elsewhere closes it', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false });
  const scout = await stillScout(page);
  await page.mouse.move(scout.x - 400, scout.y + 300);
  await page.mouse.move(scout.x, scout.y);
  await page.waitForTimeout(PASSING_MS);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel', { timeout: 1 });
  await page.mouse.move(VIEWPORT.width - 40, 6);
  await page.waitForTimeout(REST_DELAY_MS);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');

  await pointAtScout(page);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');

  await page.mouse.move(VIEWPORT.width - 40, 6);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
  await page.waitForTimeout(REST_DELAY_MS);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});

test('a request waits to open by itself while the pointer is in the menu bar', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: true, notch: false });
  await expect.poll(() => restSize(page)).not.toBeNull();
  await page.mouse.move(VIEWPORT.width - 40, 400);
  await page.mouse.move(VIEWPORT.width - 40, 6, { steps: 2 });
  await seedChats([install]);
  await expect(count(page)).toBeVisible();
  await page.waitForTimeout(REST_DELAY_MS);
  await expect(island(page)).not.toHaveAttribute('data-view', 'card');

  await page.mouse.move(VIEWPORT.width - 40, 400, { steps: 2 });
  await expect(island(page)).toHaveAttribute('data-view', 'card');
});
