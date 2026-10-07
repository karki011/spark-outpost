import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { card, CREW_REQUEST, crewChat, crewRepo, resetCrew, send } from './crew-engine.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, openIsland } from './island-home-desktop.ts';
import { openChats } from './navigation.ts';
import { frameWork, PRODUCTION, writeReport, type FrameWork } from './perf-probe.ts';
import { openPhone, resetPhone, setFakeTailscale, startPairing, turnOn } from './phone-support.ts';
import { seedChats } from './sidebar-seed.ts';

test.use({ trace: 'off' });

const SHOTS = process.env.BLOB_SHOTS ?? '';
const BUSY_LIMIT = PRODUCTION ? 5 : 25;
const POINTER_BUSY_LIMIT = PRODUCTION ? 30 : 80;
const FRAME_LIMIT = 15;
const PAINT_LIMIT = 60;

interface BlobMotion {
  blobs: number;
  running: number;
  costly: string[];
}

function blobMotion(page: Page): Promise<BlobMotion> {
  return page.evaluate(() => {
    const cheap = new Set([
      'transform',
      'opacity',
      'offset',
      'easing',
      'composite',
      'computedOffset',
    ]);
    const running = document.getAnimations().filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return (
        animation.playState === 'running' &&
        Boolean(target?.closest('.mo-root, .scout, .isl-sblob'))
      );
    });
    const costly = running.flatMap((animation) => {
      const effect = animation.effect as KeyframeEffect;
      const properties = new Set(effect.getKeyframes().flatMap((frame) => Object.keys(frame)));
      const slow = [...properties].filter((property) => !cheap.has(property));
      const name = (animation as CSSAnimation).animationName ?? 'transition';
      return slow.length ? [`${name}: ${slow.join(', ')}`] : [];
    });
    return {
      blobs: document.querySelectorAll('.mo-root.mo-always, .scout').length,
      running: running.length,
      costly: [...new Set(costly)],
    };
  });
}

async function runWithClaude() {
  const db = openTestDb();
  try {
    await db.query(`UPDATE runs SET provider = 'claude'`);
  } finally {
    await db.end();
  }
}

async function stayLive(page: Page) {
  await page.evaluate(() => {
    setInterval(() => window.dispatchEvent(new Event('wheel')), 1_000);
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.motion))
    .toBe('live');
}

function record(name: string, work: FrameWork, blobs: number) {
  writeReport(`blob-motion-${name.replaceAll(' ', '-')}`, { ...work, blobs });
  test.info().annotations.push({ type: name, description: JSON.stringify({ ...work, blobs }) });
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `blob-motion-${name}.png`) });
}

async function measure(page: Page, name: string) {
  await page.waitForTimeout(1_500);
  const motion = await blobMotion(page);
  const work = await frameWork(page);
  record(name, work, motion.blobs);
  await shot(page, name);
  expect(motion.running, `${name} has blobs in motion`).toBeGreaterThan(0);
  expect.soft(motion.costly, `${name} animates only transform and opacity`).toEqual([]);
  expect.soft(work.recalcs, `${name} style recalculations per second`).toBeLessThan(FRAME_LIMIT);
  expect.soft(work.paints, `${name} paints per second`).toBeLessThan(PAINT_LIMIT);
  expect.soft(work.busy, `${name} main thread percent`).toBeLessThan(BUSY_LIMIT);
}

test('a thinking blob in a running chat does no work on each frame', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([{ title: 'Fix billing totals', run: { status: 'running' } }]);
  await runWithClaude();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText('Fix billing totals');
  await expect(page.locator('.cstatus .mo-always')).toBeVisible();
  await page.mouse.move(700, 300);
  await stayLive(page);
  await measure(page, 'chat');
});

test('the model card blobs do no work on each frame', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').last().getByRole('tab', { name: 'Models' }).click();
  await expect(page.locator('.mc-blob .mo-root').first()).toBeVisible();
  await page.mouse.move(700, 450);
  await stayLive(page);
  await measure(page, 'models');
});

test('Home follows the pointer without restyling on every frame', async ({ page }) => {
  await resetTestDatabase({ onboarded: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.hh .scout')).toBeVisible();
  await stayLive(page);
  await measure(page, 'home');
  let moving = true;
  const wander = (async () => {
    for (let step = 0; moving; step++) {
      await page.mouse.move(500 + 300 * Math.cos(step / 20), 500 + 200 * Math.sin(step / 20));
    }
  })();
  const work = await frameWork(page);
  moving = false;
  await wander;
  record('home pointer', work, 1);
  expect.soft(work.busy, 'Home while the pointer moves').toBeLessThan(POINTER_BUSY_LIMIT);
});

test('Spark Island blobs for working and waiting chats do no work on each frame', async ({
  page,
}) => {
  await resetTestDatabase({ onboarded: true });
  await seedChats([
    { title: 'Fix billing totals', run: { status: 'running' }, minutesAgo: 1 },
    {
      title: 'Deploy the site',
      run: { status: 'awaiting_approval' },
      approval: { kind: 'execute', title: 'pnpm deploy', command: 'pnpm deploy' },
      minutesAgo: 2,
    },
  ]);
  await fakeHomeDesktop(page);
  await openIsland(page);
  await expect(page.locator('.isl-sblob')).toHaveCount(2);
  await page.mouse.move(640, 600);
  await measure(page, 'island');
});

test('the boot screen blob runs one transform animation per part', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      sparkBoot: { onStatus: () => undefined, onLeave: () => undefined, painted: () => undefined },
    });
  });
  await page.goto('/boot.html');
  await expect(page.locator('.boot-blob')).toBeVisible();
  await page.waitForTimeout(3_000);
  const stacked = await page.locator('.boot-blob').evaluate((blob) => {
    const counts = new Map<Element, number>();
    for (const animation of blob.getAnimations({ subtree: true })) {
      const effect = animation.effect as KeyframeEffect;
      const moves = effect.getKeyframes().some((frame) => 'transform' in frame);
      if (moves && effect.target) counts.set(effect.target, (counts.get(effect.target) ?? 0) + 1);
    }
    return [...counts].filter(([, count]) => count > 1).map(([part]) => part.getAttribute('class'));
  });
  const work = await frameWork(page);
  record('boot', work, 1);
  await shot(page, 'boot');
  expect(stacked).toEqual([]);
  expect.soft(work.busy, 'boot main thread percent').toBeLessThan(BUSY_LIMIT * 2);
});

test('Agent TV crew blobs do no work on each frame', async ({ page }) => {
  test.setTimeout(90_000);
  await resetCrew();
  const repo = crewRepo();
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await crewChat(page, repo, 'Ask before edits');
    await send(page, `${CREW_REQUEST} #build #crew`);
    await expect(card(page, /Change a file\?/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Agent TV' }).click();
    const tv = page.getByRole('dialog', { name: 'Agent TV' });
    await expect(tv).toBeVisible();
    await page.mouse.move(40, 880);
    await stayLive(page);
    await measure(page, 'agent tv');
  } finally {
    repo.remove();
  }
});

test('the Phone pairing blob does no work on each frame while a code waits', async ({ page }) => {
  await resetPhone();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPhone(page);
    await turnOn(page);
    await startPairing(page);
    await expect(page.locator('.ph-scene')).toHaveAttribute('data-blob', 'idle');
    await page.mouse.move(700, 300);
    await stayLive(page);
    await measure(page, 'phone pairing');
  } finally {
    setFakeTailscale(null);
  }
});
