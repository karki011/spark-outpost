import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTestDb } from './database.ts';
import { demoRepo, seedDemo, shoot, useSystemTheme, type DemoRepo } from './docs-seed.ts';
import { seedChats } from './sidebar-seed.ts';

const IMAGES = path.resolve('docs/guide/images');
const ISLAND_CLIP = { x: 340, y: 0, width: 600, height: 380 };

interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

test.skip(!process.env.SPARK_DOCS_SHOTS, 'Run pnpm docs:screenshots to write the guide images.');

let repo: DemoRepo;

test.beforeEach(async ({ page }) => {
  repo = demoRepo();
  await useSystemTheme(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
});

test.afterEach(() => repo.remove());

async function shootClip(page: Page, name: string, clip: Clip) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    await page.screenshot({
      path: path.join(IMAGES, `${name}-${scheme}.png`),
      clip,
      omitBackground: true,
      animations: 'disabled',
    });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

async function skipIslandGreeting(page: Page) {
  await page.addInitScript(() => {
    const now = new Date();
    localStorage.setItem(
      'spark-outpost.island',
      JSON.stringify({
        lastSeen: now.getTime(),
        greetedDay: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`,
      }),
    );
  });
}

async function fakeDesktop(page: Page) {
  await page.addInitScript(() => {
    const noop = () => () => undefined;
    const companion = {
      supported: true,
      enabled: true,
      shortcuts: { quick: 'Alt+Space', sessions: 'Alt+Shift+Space' },
      failed: [] as string[],
      islandSize: 'medium',
    };
    const updates = {
      currentVersion: '0.2.0',
      channel: 'stable',
      autoDownload: true,
      phase: 'ready',
      offReason: null,
      availableVersion: '0.3.0',
      progress: 100,
      installRequested: false,
      waitingForRuns: false,
      lastCheckedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      error: null,
      skippedVersion: null,
      releaseNotesUrl: 'https://updates.example.com/spark/release-notes.html',
    };
    Object.assign(window, {
      sparkDesktop: {
        platform: 'darwin',
        companion: {
          get: async () => structuredClone(companion),
          setEnabled: async () => structuredClone(companion),
          setShortcut: async () => ({ ok: true }),
          setIslandSize: async () => structuredClone(companion),
          onChange: noop,
        },
        island: { geometry: async () => null, onGeometry: noop, onCommand: noop },
        updates: {
          get: async () => structuredClone(updates),
          check: async () => structuredClone(updates),
          setChannel: async () => structuredClone(updates),
          setAutoDownload: async () => structuredClone(updates),
          install: async () => ({ status: 'installing' }),
          onChange: noop,
        },
        onOpenChat: noop,
      },
    });
  });
}

async function runsByClaude() {
  const db = openTestDb();
  try {
    await db.query(`UPDATE runs SET provider = 'claude'`);
  } finally {
    await db.end();
  }
}

const island = (page: Page) => page.getByRole('region', { name: 'Spark Island' });

async function openIsland(page: Page) {
  await page.goto('/island');
  await expect(island(page)).toBeVisible();
}

test('Desktop companion screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await skipIslandGreeting(page);
  await seedDemo(page, repo);
  await runsByClaude();
  await openIsland(page);
  await expect(island(page)).toHaveAttribute('data-view', 'peek');
  await expect(
    page.getByRole('toolbar', { name: 'Active chats' }).getByRole('button').first(),
  ).toBeVisible();

  await page.keyboard.press('Alt+Space');
  const message = island(page).getByRole('textbox', { name: 'Message' });
  await expect(message).toBeFocused();
  await message.fill('Add a currency column to the invoice CSV export');
  await shootClip(page, 'companion-island-chat', { ...ISLAND_CLIP, height: 200 });
  await message.fill('');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Alt+Shift+Space');
  const search = island(page).getByRole('combobox', { name: 'Search sessions' });
  await expect(search).toBeFocused();
  await search.fill('CSV');
  await page.keyboard.press('Enter');
  await island(page).getByRole('button', { name: 'Ask for update' }).click();
  await expect(island(page).getByRole('status').filter({ hasText: 'Next:' })).toBeVisible({
    timeout: 20_000,
  });
  await shootClip(page, 'companion-island-sessions', ISLAND_CLIP);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.mouse.move(640, 600);
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel', { timeout: 10_000 });

  await seedChats([
    {
      title: 'Run the invoice tests',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm test', command: 'pnpm test' },
    },
  ]);
  await runsByClaude();
  await expect(island(page).locator('.isl-pbadge')).toHaveText('1', { timeout: 15_000 });
  await page.keyboard.press('Alt+Space');
  await expect(island(page)).toHaveAttribute('data-view', 'card');
  const card = island(page).getByRole('group', { name: /wants to run a command/ });
  await expect(card.getByRole('button', { name: /Allow once/ })).toBeEnabled();
  await shootClip(page, 'companion-island-card', { ...ISLAND_CLIP, height: 260 });

  await page.mouse.move(640, 600);
  await page.keyboard.press('Alt+Shift+Space');
  await page.keyboard.press('Meta+1');
  await expect(island(page).getByRole('region', { name: /^Now/ })).toBeVisible();
  await shootClip(page, 'companion-island-home', { x: 290, y: 0, width: 700, height: 240 });
});

test('Companion settings and updates screenshots', async ({ page }) => {
  test.setTimeout(90_000);
  await fakeDesktop(page);
  await seedDemo(page, repo);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Notifications' })
    .click();
  const spark = page.getByRole('dialog', { name: 'Notifications' });
  const around = spark.getByRole('region', { name: 'Spark Island' });
  await expect(around.getByRole('button', { name: 'Change Quick chat shortcut' })).toBeVisible();
  await around.scrollIntoViewIfNeeded();
  await shoot(page, IMAGES, 'companion-settings', around);

  await spark.getByRole('tab', { name: 'Updates' }).click();
  const updates = page.getByRole('dialog', { name: 'Updates' });
  await expect(updates.getByRole('button', { name: 'Restart to update' })).toBeVisible();
  await shoot(page, IMAGES, 'updates-section', updates);
  await page.keyboard.press('Escape');
  await expect(updates).toBeHidden();

  const blob = page.getByRole('button', { name: /^Restart to update/ });
  await expect(blob).toBeVisible();
  const box = (await blob.boundingBox())!;
  await shootClip(page, 'updates-rail-blob', {
    x: 0,
    y: Math.max(0, box.y - 24),
    width: box.x * 2 + box.width,
    height: box.height + 96,
  });
});
