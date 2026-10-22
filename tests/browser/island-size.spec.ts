import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';
import { pointAtScout } from './island-pointer.ts';
import { ISLAND_BLOB } from '../../packages/contracts/src/island-size.ts';

const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });

interface SizeWindow {
  setIslandSize(size: string): void;
  islandRest: ({ width: number; height: number } | null)[];
}

async function openSizedIsland(page: Page) {
  await page.addInitScript(() => {
    const none = () => () => undefined;
    const listeners = new Set<(status: unknown) => void>();
    const status = {
      supported: true,
      enabled: true,
      shortcuts: { quick: 'Alt+Space', sessions: 'Alt+Shift+Space' },
      failed: [],
      islandSize: 'small',
    };
    const rest: unknown[] = [];
    Object.assign(window, {
      islandRest: rest,
      setIslandSize: (size: string) => {
        status.islandSize = size;
        listeners.forEach((listener) => listener({ ...status }));
      },
      sparkDesktop: {
        platform: 'darwin',
        companion: {
          get: async () => ({ ...status }),
          onChange: (listener: (next: unknown) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        island: {
          geometry: async () => ({
            notch: false,
            top: 24,
            notchWidth: 0,
            docked: true,
            menuBar: 24,
          }),
          onGeometry: none,
          onCommand: none,
          onEscape: none,
          sparkFocused: async () => false,
          onSparkFocus: none,
          pathForFile: () => null,
          setInteractive: () => undefined,
          setFocusable: () => undefined,
          drag: () => undefined,
          openChat: () => undefined,
          setRestSize: (size: unknown) => rest.push(size),
        },
        onOpenChat: none,
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
}

const setSize = (page: Page, size: string) =>
  page.evaluate((next) => (window as unknown as SizeWindow).setIslandSize(next), size);

const lastRest = (page: Page) =>
  page.evaluate(() => (window as unknown as SizeWindow).islandRest.at(-1) ?? null);

async function settledBoxes(page: Page) {
  let last = '';
  await expect
    .poll(async () => {
      const boxes = JSON.stringify([
        await island(page).boundingBox(),
        await island(page).locator('.isl-scout-wrap').boundingBox(),
      ]);
      const same = boxes === last;
      last = boxes;
      return same;
    })
    .toBe(true);
}

async function restingBlob(page: Page, size: number, tuck: number) {
  const scout = island(page).locator('.isl-scout-wrap');
  await expect.poll(async () => (await scout.boundingBox())!.height).toBe(size);
  await expect.poll(async () => (await scout.boundingBox())!.y).toBe(-tuck);
  const eyes = await island(page)
    .locator('.sc-eye')
    .evaluateAll((all) => all.map((eye) => eye.getBoundingClientRect()));
  expect(Math.min(...eyes.map((eye) => eye.top))).toBeGreaterThanOrEqual(0);
  expect(Math.max(...eyes.map((eye) => eye.bottom))).toBeLessThanOrEqual(size - tuck);
  await expect.poll(async () => (await lastRest(page))?.width ?? 0).toBeGreaterThan(size);
  return (await lastRest(page))!;
}

test('the resting island follows the chosen size live and still opens on hover', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openSizedIsland(page);
  await expect(island(page)).toHaveClass(/\bbare\b/);
  const small = await restingBlob(page, 38, 20);

  await setSize(page, 'large');
  const large = await restingBlob(page, 58, 31);
  expect(large.width).toBeGreaterThan(small.width);
  expect(large.height).toBeGreaterThan(small.height);
  expect((await island(page).boundingBox())!.y).toBe(0);

  await setSize(page, 'xlarge');
  const extra = await restingBlob(page, 116, 61);
  expect(Math.abs(extra.width - (116 + 2 * 14))).toBeLessThanOrEqual(1);
  expect(Math.abs(extra.height - (116 - 61 + 14))).toBeLessThanOrEqual(1);

  await setSize(page, 'medium');
  await restingBlob(page, 48, 25);
  await pointAtScout(page);
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
  await expect.poll(() => lastRest(page)).toBeNull();
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await restingBlob(page, 48, 25);
});

test('a pending request rests as Scout with a count at every size, including saved Full', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await openSizedIsland(page);
  await seedChats([
    {
      title: 'Speed up the test suite',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'npm test', command: 'npm test' },
    },
  ]);
  const count = island(page).locator('.isl-pbadge');
  await expect(count).toHaveText('1');
  const scout = island(page).locator('.isl-scout-wrap');
  for (const size of ['small', 'medium', 'large', 'xlarge', 'full'] as const) {
    await setSize(page, size);
    await expect(island(page)).toHaveAttribute('data-view', 'peek');
    await expect(island(page).locator('.isl-restline, .isl-view')).toHaveCount(0);
    await expect(count).toHaveText('1');
    await settledBoxes(page);
    const blob = (await scout.boundingBox())!;
    expect(Math.abs(blob.x + blob.width / 2 - 640)).toBeLessThanOrEqual(1);
    await expect
      .poll(async () => (await lastRest(page))?.width ?? 0)
      .toBeLessThanOrEqual(ISLAND_BLOB[size] + 2 * 14 + 2);
    const rest = (await lastRest(page))!;
    expect(rest.width).toBeGreaterThanOrEqual(blob.width);
    expect(rest.height).toBeGreaterThanOrEqual(blob.y + blob.height);
  }
  await pointAtScout(page);
  const line = island(page).locator('.isl-hover');
  await expect(line).toContainText('Speed up the test suite');
  await expect(line.getByRole('button', { name: 'Deny' })).toBeVisible();
  await page.mouse.move(5, 600);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await island(page).locator('.isl-scout-btn').click();
  const card = island(page).getByRole('article', { name: 'Speed up the test suite needs you' });
  await expect(card).toContainText('npm test');
  await page.keyboard.press('Escape');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
});
