import { expect, test, type Locator, type Page } from '@playwright/test';
import { hitsIsland } from '../../packages/contracts/src/island-hit.ts';
import { resetTestDatabase } from './database.ts';
import {
  island,
  latestRegions,
  openNotchIsland,
  restSize,
  VIEWPORT,
} from './island-notch-desktop.ts';
import { pointAtScout } from './island-pointer.ts';
import { seedChats } from './sidebar-seed.ts';

const REST_DELAY_MS = 700;
const install = {
  title: 'Add the image library',
  run: { status: 'awaiting_approval' },
  approval: { kind: 'execute', title: 'npm install sharp', command: 'npm install sharp' },
};

const line = (page: Page) => island(page).locator('.isl-restline');

async function settledBox(page: Page) {
  let last: Awaited<ReturnType<Locator['boundingBox']>> = null;
  await expect
    .poll(
      async () => {
        const now = await line(page).boundingBox();
        const still =
          last !== null &&
          now !== null &&
          Math.abs(now.x - last.x) < 0.5 &&
          Math.abs(now.y - last.y) < 0.5 &&
          Math.abs(now.height - last.height) < 0.5;
        last = now;
        return still;
      },
      { intervals: [100] },
    )
    .toBe(true);
  return last!;
}

async function takesPointerAt(page: Page, x: number, y: number): Promise<boolean> {
  const regions = await latestRegions(page);
  return regions !== null && hitsIsland(regions, x, y);
}

test('a request line takes the pointer as soon as it appears, with no hover first', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openNotchIsland(page, { size: 'large', autoExpand: false, notch: false });
  await expect.poll(() => restSize(page)).not.toBeNull();
  await seedChats([install]);
  await expect(line(page)).toBeVisible();
  const shownAt = Date.now();
  const box = (await line(page).boundingBox())!;
  const right = { x: box.x + box.width - 4, y: box.y + box.height / 2 };

  await expect.poll(() => takesPointerAt(page, right.x, right.y)).toBe(true);
  await expect
    .poll(async () => ((await restSize(page))?.width ?? 0) / 2)
    .toBeGreaterThanOrEqual(box.x + box.width - VIEWPORT.width / 2);
  expect(Date.now() - shownAt).toBeLessThan(REST_DELAY_MS);
  expect((await restSize(page))!.height).toBeGreaterThanOrEqual(box.y + box.height);

  const still = await settledBox(page);
  const middle = still.y + still.height / 2;
  await expect.poll(() => takesPointerAt(page, still.x + still.width - 4, middle)).toBe(true);
  expect(await takesPointerAt(page, still.x + still.width + 6, middle)).toBe(false);
  expect(await takesPointerAt(page, still.x + still.width - 4, still.y + still.height + 6)).toBe(
    false,
  );

  await line(page).click();
  await expect(island(page)).toHaveAttribute('data-view', 'card');
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
