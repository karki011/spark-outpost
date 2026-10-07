import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { REPO_ROOT, serveMap, syntheticFixture } from './map-fixture.ts';
import { beginTrace, endTrace, expectWithin, needsQuietMachine, STRICT } from './perf-trace.ts';

test.use({
  trace: 'off',
});

const PRODUCTION = Boolean(process.env.SPARK_WEB_BUILD);
const TREE_TASK_MS = PRODUCTION ? 50 : 250;
const PAN_TASK_MS = 50;
const FRAME_MS = 20;

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('a 20,000 file map stays smooth while panning and zooming', async ({ page }) => {
  needsQuietMachine();
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.request.post('/api/projects', { data: { rootPath: REPO_ROOT } });
  const projectId = ((await response.json()) as { id: string }).id;
  await serveMap(page, syntheticFixture(projectId, 20_000, 240));
  await page.addInitScript(() => {
    localStorage.setItem('spark-outpost.view', 'map');
    localStorage.setItem('spark-outpost.map-view', '"sky"');
  });
  await page.goto('/');
  await expect(page.getByRole('application', { name: /240 areas/ })).toBeVisible();
  const box = (await page.locator('.map-stage').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, -240);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const record = { frames: [] as number[] };
    (window as unknown as { mapPerf: typeof record }).mapPerf = record;
    let last = performance.now();
    const tick = (now: number) => {
      record.frames.push(now - last);
      last = now;
      if (record.frames.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await beginTrace(page);
  await page.mouse.down();
  for (let step = 0; step < 60; step += 1) {
    await page.mouse.move(x + Math.sin(step / 6) * 300, y + Math.cos(step / 6) * 160);
  }
  await page.mouse.up();
  for (let step = 0; step < 16; step += 1) await page.mouse.wheel(0, step < 8 ? 180 : -180);
  const work = await endTrace(page);
  const perf = await page.evaluate(
    () => (window as unknown as { mapPerf: { frames: number[] } }).mapPerf,
  );
  const frames = perf.frames.slice(1).sort((a, b) => a - b);
  const median = frames[Math.floor(frames.length / 2)]!;
  test.info().annotations.push({
    type: 'frames',
    description: JSON.stringify({
      frames: frames.length,
      medianMs: Number(median.toFixed(1)),
      p95Ms: Number(frames[Math.floor(frames.length * 0.95)]!.toFixed(1)),
      work,
    }),
  });
  if (STRICT) expect.soft(median, 'median frame in ms').toBeLessThan(FRAME_MS);
  expect
    .soft(work.total.cpuMs / frames.length, 'main-thread work per frame in ms')
    .toBeLessThan(FRAME_MS);
  expectWithin(work.longest, PAN_TASK_MS, 'longest task while panning and zooming');
});

test('the tree of a 20,000 file map opens groups and pans without long main-thread tasks', async ({
  page,
}) => {
  needsQuietMachine();
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.request.post('/api/projects', { data: { rootPath: REPO_ROOT } });
  const projectId = ((await response.json()) as { id: string }).id;
  await serveMap(page, syntheticFixture(projectId, 20_000, 240));
  await page.addInitScript(() => {
    localStorage.setItem('spark-outpost.view', 'map');
    localStorage.setItem('spark-outpost.map-view', '"tree"');
  });
  await page.goto('/');
  const tree = page.getByRole('application', { name: /^Tree of .*240 areas/ });
  await expect(tree).toBeVisible();
  await expect(tree.locator('[data-tree-node]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Fit the whole tree' }).click();
  const box = (await page.locator('.map-stage').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  for (let step = 0; step < 4; step += 1) await page.mouse.wheel(0, step < 2 ? -120 : 120);
  await page.waitForTimeout(1500);
  await beginTrace(page);
  const started = Date.now();
  await tree.getByRole('button', { name: /^Other in src, group of \d+ areas/ }).focus();
  await page.keyboard.press('Enter');
  await expect(
    tree.getByRole('button', { name: /^Other in src, .*Press Escape to close/ }),
  ).toBeVisible();
  await expect(tree.getByRole('button', { name: /^Area \d+, area/ }).first()).toBeVisible();
  const opened = Date.now() - started;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.move(x + Math.sin(step / 5) * 300, y + Math.cos(step / 5) * 160);
  }
  await page.mouse.up();
  for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, step < 6 ? -200 : 200);
  await tree
    .getByRole('button', { name: /^Area \d+, area/ })
    .first()
    .focus();
  await page.keyboard.press('Enter');
  await expect(tree.locator('.react-flow__node-file').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  const work = await endTrace(page);
  test.info().annotations.push({
    type: 'tree',
    description: JSON.stringify({ production: PRODUCTION, openedMs: opened, work }),
  });
  expectWithin(work.longest, TREE_TASK_MS, 'longest task in the tree');
});
