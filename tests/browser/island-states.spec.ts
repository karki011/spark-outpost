import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { seedChats } from './sidebar-seed.ts';

const SHOTS = process.env.ISLAND_SHOTS ?? '';

const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });
const peekRow = (page: Page) => page.getByRole('toolbar', { name: 'Active chats' });
const blob = (page: Page, title: string) =>
  peekRow(page).getByRole('button', { name: new RegExp(`^Chat: ${title}, `) });

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

function pseudoAnimation(target: Locator) {
  return target.evaluate((element) => {
    const ring = getComputedStyle(element, '::before');
    return { name: ring.animationName, opacity: ring.opacity };
  });
}

function endlessAnimations(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.effect?.getTiming().iterations === Infinity)
      .map((animation) => (animation as CSSAnimation).animationName)
      .filter((name) => name.startsWith('isl-ps') || name === 'isl-wobble'),
  );
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(SHOTS, `island-states-${name}.png`),
    clip: { x: 500, y: 0, width: 280, height: 72 },
  });
}

test('each peeking chat shows whether it is working, needs you, done, failed or quiet', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedEveryState();
  await fakeDesktop(page, { size: 'medium', notch: true, theme: 'graphite' });

  await expect(peekRow(page).getByRole('button', { name: /^Chat: / })).toHaveCount(5);
  await expect(blob(page, 'Fix billing totals')).toHaveAttribute('data-state', 'working');
  await expect(blob(page, 'Fix billing totals')).toHaveAccessibleName(
    'Chat: Fix billing totals, working',
  );
  await expect(blob(page, 'Deploy the site')).toHaveAttribute('data-state', 'waiting');
  await expect(blob(page, 'Deploy the site')).toHaveAccessibleName(
    'Chat: Deploy the site, needs you',
  );
  await expect(blob(page, 'Tidy the README')).toHaveAttribute('data-state', 'done');
  await expect(blob(page, 'Speed up cold start')).toHaveAttribute('data-state', 'failed');
  await expect(blob(page, 'Sketch the pricing page')).toHaveAttribute('data-state', 'idle');

  expect(await pseudoAnimation(blob(page, 'Fix billing totals'))).toEqual({
    name: 'isl-ps-spin',
    opacity: '1',
  });
  expect((await pseudoAnimation(blob(page, 'Deploy the site'))).name).toBe('isl-ps-halo');
  await expect(blob(page, 'Deploy the site').locator('.isl-pb')).toHaveText('!');
  await expect(blob(page, 'Speed up cold start').locator('.isl-pb')).toHaveText('!');
  await expect(blob(page, 'Tidy the README').locator('.isl-pb')).toHaveAttribute(
    'data-state',
    'done',
  );
  await expect(blob(page, 'Sketch the pricing page').locator('.isl-pb')).toHaveCount(0);
  expect((await pseudoAnimation(blob(page, 'Sketch the pricing page'))).opacity).toBe('0');

  await expect(blob(page, 'Deploy the site').locator('.isl-tip')).toContainText('Needs you');
  await expect(blob(page, 'Fix billing totals').locator('.isl-tip')).toContainText('Working…');
});

test('only working and waiting chats keep moving while the island rests', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Tidy the README', run: { status: 'succeeded' }, minutesAgo: 1 },
    { title: 'Speed up cold start', run: { status: 'failed', error: 'tests' }, minutesAgo: 2 },
    { title: 'Sketch the pricing page', minutesAgo: 3 },
  ]);
  await fakeDesktop(page, { size: 'small', notch: false, theme: 'graphite' });
  await expect(peekRow(page).getByRole('button', { name: /^Chat: / })).toHaveCount(3);
  await expect(page.locator('.isl-root')).toHaveAttribute('data-rest', 'true');
  expect(await endlessAnimations(page)).toEqual([]);

  await seedChats([{ title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 0 }]);
  await expect(blob(page, 'Fix billing totals')).toHaveAttribute('data-state', 'working');
  await expect.poll(() => endlessAnimations(page)).toContain('isl-ps-spin');
});

test('reduced motion keeps a still ring and halo', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetTestDatabase({ onboarded: true });
  await seedEveryState();
  await fakeDesktop(page, { size: 'large', notch: false, theme: 'apricot' });
  await expect(blob(page, 'Fix billing totals')).toHaveAttribute('data-state', 'working');
  expect(await pseudoAnimation(blob(page, 'Fix billing totals'))).toEqual({
    name: 'none',
    opacity: '1',
  });
  expect(await endlessAnimations(page)).toEqual([]);
});

test.describe('screenshots', () => {
  test.use({ deviceScaleFactor: 3 });
  for (const size of ['small', 'medium', 'large'] as const) {
    for (const notch of [true, false]) {
      test(`shows every chat state at ${size} size ${notch ? 'under a notch' : 'flat'}`, async ({
        page,
      }) => {
        test.skip(!SHOTS, 'screenshots only');
        await resetTestDatabase({ onboarded: true });
        await seedEveryState();
        await fakeDesktop(page, { size, notch, theme: size === 'medium' ? 'apricot' : 'graphite' });
        await expect(peekRow(page).getByRole('button', { name: /^Chat: / })).toHaveCount(5);
        await shot(page, `${size}-${notch ? 'notch' : 'flat'}`);
      });
    }
  }
});
