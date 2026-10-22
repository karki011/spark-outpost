import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openHeavyChat } from './heavy-chat.ts';

test.use({ trace: 'off' });

const PRODUCTION = Boolean(process.env.SPARK_WEB_BUILD);
const DRAG_TASK_MS = PRODUCTION ? 50 : 4_000;
const CLICK_MS = PRODUCTION ? 100 : 2_500;
const DRAG_STYLE_ELEMENTS = 200;
const IDLE_LAYERS = 80;
const REPORT = process.env.SPARK_PERF_REPORT ?? '';

interface TraceEvent {
  name: string;
  ph: string;
  dur?: number;
  args?: { elementCount?: number };
}

interface DragCost {
  longTasks: number[];
  styleElements: number[];
}

async function watchLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { longTasks: number[] };
    scope.longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) scope.longTasks.push(Math.round(entry.duration));
    }).observe({ type: 'longtask' });
  });
}

async function takeLongTasks(page: Page): Promise<number[]> {
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
  return page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks.splice(0));
}

async function dragCost(
  page: Page,
  browser: Browser,
  handle: Locator,
  distance: number,
): Promise<DragCost> {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.sign(distance), y);
  await takeLongTasks(page);
  await browser.startTracing(page, { categories: ['devtools.timeline'] });
  for (let step = 1; step <= 30; step += 1) {
    await page.mouse.move(x + Math.sin((step / 30) * Math.PI) * distance, y);
  }
  const trace = JSON.parse((await browser.stopTracing()).toString()) as {
    traceEvents: TraceEvent[];
  };
  const longTasks = await takeLongTasks(page);
  await page.mouse.up();
  const styleElements = trace.traceEvents
    .filter((event) => event.name === 'UpdateLayoutTree' && event.ph === 'X')
    .map((event) => event.args?.elementCount ?? 0);
  return { longTasks, styleElements };
}

async function clickLatency(button: Locator): Promise<number> {
  const ms = await button.evaluate(
    (element: HTMLElement) =>
      new Promise<number>((resolve) => {
        const started = performance.now();
        element.click();
        requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - started), 0));
      }),
  );
  return Math.round(ms);
}

async function compositedLayers(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  const layers = new Promise<number>((resolve) => {
    cdp.on('LayerTree.layerTreeDidChange', (event) => {
      if (event.layers) resolve(event.layers.length);
    });
  });
  await cdp.send('LayerTree.enable');
  const count = await layers;
  await cdp.detach();
  return count;
}

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true });
});

test('a heavy chat resizes and switches panels without long main-thread work', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await openHeavyChat(page);
  const work = page.getByRole('complementary', { name: 'Work panel' });
  await expect(work.getByRole('tab', { name: 'To-do' })).toBeVisible();
  await page.waitForTimeout(1500);
  const layers = await compositedLayers(page);
  await watchLongTasks(page);

  const panelDrag = await dragCost(
    page,
    browser,
    page.getByRole('separator', { name: 'Resize work panel' }),
    -160,
  );
  const sidebarDrag = await dragCost(
    page,
    browser,
    page.getByRole('separator', { name: 'Resize sidebar' }),
    100,
  );

  const clicks: Record<string, number> = {};
  for (const name of ['Plan', 'Crew', 'Links', 'Cost', 'To-do']) {
    const tab = work.getByRole('tab', { name });
    if ((await tab.count()) === 0) continue;
    clicks[name] = await clickLatency(tab);
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
  }
  const header = page.getByRole('main').locator('.head');
  clicks.hide = await clickLatency(header.getByRole('button', { name: 'Hide work panel' }));
  await expect(work).toBeHidden({ timeout: 20_000 });
  await page.waitForTimeout(600);
  clicks.show = await clickLatency(header.getByRole('button', { name: 'Show work panel' }));
  await expect(work).toBeVisible({ timeout: 20_000 });
  const clickTasks = await takeLongTasks(page);

  const summary = { layers, panelDrag, sidebarDrag, clicks, clickTasks };
  test.info().annotations.push({ type: 'perf', description: JSON.stringify(summary) });
  if (REPORT) {
    mkdirSync(REPORT, { recursive: true });
    writeFileSync(`${REPORT}/chat-perf.json`, JSON.stringify(summary, null, 2));
    await page.screenshot({ path: `${REPORT}/heavy-chat.png` });
  }

  expect(layers).toBeLessThan(IDLE_LAYERS);
  for (const drag of [panelDrag, sidebarDrag]) {
    expect(Math.max(0, ...drag.styleElements)).toBeLessThan(DRAG_STYLE_ELEMENTS);
    expect(Math.max(0, ...drag.longTasks)).toBeLessThan(DRAG_TASK_MS);
  }
  expect(Math.max(...Object.values(clicks))).toBeLessThan(CLICK_MS);
});
