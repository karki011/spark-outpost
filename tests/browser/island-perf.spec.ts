import { expect, test, type Page } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { fakeHomeDesktop, island, openIsland } from './island-home-desktop.ts';
import {
  CLICK_LIMIT_MS,
  clickFeedbackMs,
  restingBusyPercent,
  PRODUCTION,
  settledMetrics,
  startProbe,
  takeProbe,
  TASK_LIMIT_MS,
  writeReport,
  type ProbeResult,
} from './perf-probe.ts';
import { seedTourChats } from './tour-seed.ts';

test.use({ trace: 'off' });

const LIVE_STEPS = 40;
const IDLE_BUSY_LIMIT = 5;

async function addSteps(conversationId: string, count: number) {
  const db = openTestDb();
  try {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [conversationId],
    );
    const runId = rows[0]!.id;
    for (let step = 0; step < count; step++) {
      for (const type of ['STEP_STARTED', 'STEP_FINISHED']) {
        await db.query(
          `INSERT INTO run_events (run_id, seq, type, payload)
           VALUES ($1, (SELECT COALESCE(max(seq), 0) + 1 FROM run_events WHERE run_id = $1), $2, $3)`,
          [runId, type, JSON.stringify({ type, stepName: `Edit src/part-${step}.ts` })],
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  } finally {
    await db.end();
  }
}

async function hoverOpen(page: Page) {
  await page.mouse.move(640, 300);
  await page.mouse.move(640, 8, { steps: 4 });
  await expect(island(page)).toHaveAttribute('data-view', 'panel');
}

async function leave(page: Page) {
  await page.mouse.move(5, 600, { steps: 4 });
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel', { timeout: 10_000 });
}

test('Spark Island stays smooth with many chats and live activity', async ({ page }) => {
  test.setTimeout(240_000);
  await resetTestDatabase({ onboarded: true });
  const [running] = await seedTourChats();
  await fakeHomeDesktop(page);
  await openIsland(page);
  await page.waitForTimeout(1_500);
  const before = await settledMetrics(page);
  const restingBusy = await restingBusyPercent(page);
  await startProbe(page);
  const phases: Record<string, ProbeResult> = {};

  for (let round = 0; round < 4; round++) {
    await hoverOpen(page);
    await page.waitForTimeout(400);
    await leave(page);
  }
  phases['hover open and close x4'] = await takeProbe(page);

  await hoverOpen(page);
  const chats = island(page).getByRole('tab', { name: /^Chats/ });
  const chatsClickMs = await clickFeedbackMs(chats);
  await expect(chats).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(1_200);
  phases['open Chats'] = await takeProbe(page);
  const search = island(page).getByRole('searchbox').first();
  if (await search.isVisible()) {
    await search.pressSequentially('image', { delay: 40 });
    await search.fill('');
  }
  phases['search Chats'] = await takeProbe(page);

  const home = island(page).getByRole('tab', { name: 'Home' });
  const homeClickMs = await clickFeedbackMs(home);
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await addSteps(running!, LIVE_STEPS);
  await page.waitForTimeout(1_500);
  phases['Home with live steps'] = await takeProbe(page);
  await page.keyboard.press('Escape');
  await expect(island(page)).not.toHaveAttribute('data-view', 'panel');
  await page.waitForTimeout(1_000);
  const after = await settledMetrics(page);

  const summary = {
    chats: 50,
    liveSteps: LIVE_STEPS,
    restingBusyPercent: restingBusy,
    clicks: { chats: chatsClickMs, home: homeClickMs },
    phases,
    growth: {
      heapMb: Number((after.heapMb - before.heapMb).toFixed(1)),
      nodes: after.nodes - before.nodes,
      listeners: after.listeners - before.listeners,
    },
  };
  writeReport('island', summary);
  test.info().annotations.push({ type: 'island perf', description: JSON.stringify(summary) });

  expect(Math.max(chatsClickMs, homeClickMs)).toBeLessThan(CLICK_LIMIT_MS);
  for (const [name, phase] of Object.entries(phases)) {
    expect.soft(phase.maxTaskMs, name).toBeLessThan(TASK_LIMIT_MS);
  }
  if (PRODUCTION) expect(restingBusy).toBeLessThan(IDLE_BUSY_LIMIT);
  expect(summary.growth.listeners).toBeLessThan(200);
});
