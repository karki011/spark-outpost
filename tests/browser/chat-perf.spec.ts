import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openHeavyChat } from './heavy-chat.ts';
import {
  beginTrace,
  clickCost,
  endTrace,
  expectWithin,
  needsQuietMachine,
  type Cost,
  type TaskSummary,
} from './perf-trace.ts';

test.use({ trace: 'off' });

const PRODUCTION = Boolean(process.env.SPARK_WEB_BUILD);
const DRAG_TASK_MS = PRODUCTION ? 50 : 4_000;
const CLICK_MS = PRODUCTION ? 100 : 2_500;
const DRAG_STYLE_ELEMENTS = 200;
const IDLE_LAYERS = 80;
const REPORT = process.env.SPARK_PERF_REPORT ?? '';

async function dragCost(page: Page, handle: Locator, distance: number): Promise<TaskSummary> {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.sign(distance), y);
  await page.waitForTimeout(300);
  await beginTrace(page);
  for (let step = 1; step <= 30; step += 1) {
    await page.mouse.move(x + Math.sin((step / 30) * Math.PI) * distance, y);
  }
  await page.waitForTimeout(300);
  const cost = await endTrace(page);
  await page.mouse.up();
  return cost;
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

test('a heavy chat resizes and switches panels without long main-thread work', async ({ page }) => {
  needsQuietMachine();
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await openHeavyChat(page);
  const work = page.getByRole('complementary', { name: 'Work panel' });
  await expect(work.getByRole('tab', { name: 'Tasks' })).toBeVisible();
  await page.waitForTimeout(1500);
  const layers = await compositedLayers(page);

  const panelDrag = await dragCost(
    page,
    page.getByRole('separator', { name: 'Resize work panel' }),
    -160,
  );
  const sidebarDrag = await dragCost(
    page,
    page.getByRole('separator', { name: 'Resize sidebar' }),
    100,
  );

  const clicks: Record<string, Cost> = {};
  for (const name of ['Plan', 'Crew', 'Links', 'Cost', 'Tasks']) {
    const tab = work.getByRole('tab', { name });
    if ((await tab.count()) === 0) continue;
    clicks[name] = await clickCost(tab);
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
  }
  const header = page.getByRole('main').locator('.head');
  clicks.hide = await clickCost(header.getByRole('button', { name: 'Hide work panel' }));
  await expect(work).toBeHidden({ timeout: 20_000 });
  await page.waitForTimeout(600);
  clicks.show = await clickCost(header.getByRole('button', { name: 'Show work panel' }));
  await expect(work).toBeVisible({ timeout: 20_000 });

  const summary = { layers, panelDrag, sidebarDrag, clicks };
  test.info().annotations.push({ type: 'perf', description: JSON.stringify(summary) });
  if (REPORT) {
    mkdirSync(REPORT, { recursive: true });
    writeFileSync(`${REPORT}/chat-perf.json`, JSON.stringify(summary, null, 2));
    await page.screenshot({ path: `${REPORT}/heavy-chat.png` });
  }

  expect(layers).toBeLessThan(IDLE_LAYERS);
  for (const [name, drag] of Object.entries({ panelDrag, sidebarDrag })) {
    expect.soft(drag.styleElements, `${name} restyled elements`).toBeLessThan(DRAG_STYLE_ELEMENTS);
    expectWithin(drag.longest, DRAG_TASK_MS, `${name} longest task`);
  }
  for (const [name, click] of Object.entries(clicks)) {
    expectWithin(click, CLICK_MS, `${name} click to next paint`);
  }
});
