import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { REPO_ROOT, serveMap, syntheticFixture } from './map-fixture.ts';

test.use({
  trace: 'off',
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('a 20,000 file map stays smooth while panning and zooming', async ({ page }) => {
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
    const record = { frames: [] as number[], long: [] as number[] };
    (window as unknown as { mapPerf: typeof record }).mapPerf = record;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record.long.push(entry.duration);
    }).observe({ type: 'longtask' });
    let last = performance.now();
    const tick = (now: number) => {
      record.frames.push(now - last);
      last = now;
      if (record.frames.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.down();
  for (let step = 0; step < 60; step += 1) {
    await page.mouse.move(x + Math.sin(step / 6) * 300, y + Math.cos(step / 6) * 160);
  }
  await page.mouse.up();
  for (let step = 0; step < 16; step += 1) await page.mouse.wheel(0, step < 8 ? 180 : -180);
  const perf = await page.evaluate(
    () => (window as unknown as { mapPerf: { frames: number[]; long: number[] } }).mapPerf,
  );
  const frames = perf.frames.slice(1).sort((a, b) => a - b);
  const median = frames[Math.floor(frames.length / 2)]!;
  test.info().annotations.push({
    type: 'frames',
    description: `frames ${frames.length}, median ${median.toFixed(1)} ms, p95 ${frames[Math.floor(frames.length * 0.95)]!.toFixed(1)} ms, long tasks ${JSON.stringify(perf.long.map(Math.round))}`,
  });
  expect(median).toBeLessThan(20);
  expect(perf.long.filter((duration) => duration > 50)).toEqual([]);
});
