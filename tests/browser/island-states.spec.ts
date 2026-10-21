import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';

const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });
const strip = (page: Page) => island(page).locator('.isl-strip');
const working = (page: Page) => island(page).locator('.isl-strip-work');

interface Setup {
  size: 'small' | 'medium' | 'large';
  notch: boolean;
  theme: string;
}

async function fakeDesktop(page: Page, setup: Setup) {
  await page.addInitScript((setup) => {
    const now = new Date();
    localStorage.setItem('spark-outpost.theme', setup.theme);
    localStorage.setItem(
      'spark-outpost.island',
      JSON.stringify({
        lastSeen: now.getTime(),
        greetedDay: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`,
      }),
    );
    const none = () => () => undefined;
    const status = {
      supported: true,
      enabled: true,
      shortcuts: { quick: 'Alt+Space', sessions: 'Alt+Shift+Space' },
      failed: [],
      islandSize: setup.size,
    };
    Object.assign(window, {
      sparkDesktop: {
        platform: 'darwin',
        companion: { get: async () => status, onChange: none },
        island: {
          geometry: async () => ({
            notch: setup.notch,
            top: setup.notch ? 32 : 24,
            notchWidth: setup.notch ? 190 : 0,
            docked: true,
            menuBar: setup.notch ? 32 : 24,
          }),
          onGeometry: none,
          onCommand: none,
          onEscape: none,
          sparkFocused: async () => true,
          onSparkFocus: none,
          pickFolder: async () => null,
          pathForFile: () => null,
          setInteractive: () => undefined,
          setFocusable: () => undefined,
          drag: () => undefined,
          openChat: () => undefined,
          setRestSize: () => undefined,
        },
        onOpenChat: none,
      },
    });
  }, setup);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
}

function seedEveryState() {
  return seedChats([
    { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 },
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
      minutesAgo: 2,
    },
    { title: 'Tidy the README', run: { status: 'succeeded' }, minutesAgo: 3 },
    { title: 'Speed up cold start', run: { status: 'failed', error: 'tests' }, minutesAgo: 4 },
    { title: 'Sketch the pricing page', minutesAgo: 5 },
  ]);
}

function runningLoops(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
      .filter((animation) => animation.playState === 'running')
      .map((animation) => (animation as CSSAnimation).animationName),
  );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(SHOTS, `island-states-${name}.png`),
    clip: { x: 380, y: 0, width: 520, height: 110 },
  });
}

test('the strip counts requests and shows only working chats as blobs', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedEveryState();
  await fakeDesktop(page, { size: 'medium', notch: true, theme: 'graphite' });

  await expect(island(page)).toHaveAttribute('data-view', 'now');
  await expect(strip(page).locator('.isl-strip-count')).toHaveAttribute('aria-label', '1 need you');
  await expect(working(page)).toHaveAttribute('aria-label', '1 working');
  await expect(strip(page).locator('.isl-sblob')).toHaveCount(1);
  await expect(working(page).locator('.isl-sblob')).toHaveAttribute('data-state', 'working');
  await expect(strip(page)).toHaveText(/^1\s*1$/);
  await expect(island(page).locator('.isl-sblob:not([data-state="working"])')).toHaveCount(0);
});

test('with only finished, failed or quiet chats the island rests as Scout and nothing loops', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Tidy the README', run: { status: 'succeeded' }, minutesAgo: 1 },
    { title: 'Speed up cold start', run: { status: 'failed', error: 'tests' }, minutesAgo: 2 },
    { title: 'Sketch the pricing page', minutesAgo: 3 },
  ]);
  await fakeDesktop(page, { size: 'small', notch: false, theme: 'graphite' });
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(island(page).locator('.isl-strip, .isl-sblob')).toHaveCount(0);
  await expect(page.locator('.isl-root')).toHaveAttribute('data-rest', 'true');
  expect(await runningLoops(page)).toEqual([]);

  await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 0 }]);
  await expect(working(page)).toHaveAttribute('aria-label', '1 working');
  await expect(page.locator('.isl-root')).toHaveAttribute('data-rest', 'true');
  await expect.poll(() => runningLoops(page)).toContain('sc-spin');
});

test('reduced motion keeps the resting strip still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetTestDatabase({ onboarded: true });
  await seedEveryState();
  await fakeDesktop(page, { size: 'large', notch: false, theme: 'apricot' });
  await expect(working(page).locator('.isl-sblob')).toHaveAttribute('data-state', 'working');
  await page.waitForTimeout(500);
  expect(await runningLoops(page)).toEqual([]);
});

test.describe('screenshots', () => {
  test.use({ deviceScaleFactor: 3 });
  for (const size of ['small', 'medium', 'large'] as const) {
    for (const notch of [true, false]) {
      test(`shows the resting strip at ${size} size ${notch ? 'under a notch' : 'flat'}`, async ({
        page,
      }) => {
        test.skip(!SHOTS, 'screenshots only');
        await resetTestDatabase({ onboarded: true });
        await seedEveryState();
        await fakeDesktop(page, { size, notch, theme: size === 'medium' ? 'apricot' : 'graphite' });
        await expect(working(page)).toHaveAttribute('aria-label', '1 working');
        await shot(page, `${size}-${notch ? 'notch' : 'flat'}`);
      });
    }
  }
});
