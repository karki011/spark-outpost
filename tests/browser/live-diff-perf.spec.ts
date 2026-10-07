import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { crewRepo, pickPermission, type CrewRepo } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import {
  CLICK_LIMIT_MS,
  lagMs,
  lagWarningsSince,
  markServerLogs,
  startProbe,
  takeProbe,
  TASK_LIMIT_MS,
  writeReport,
  type ProbeResult,
} from './perf-probe.ts';
import { clickCost, expectWithin, type Cost } from './perf-trace.ts';

test.use({ trace: 'off' });

const EDITS = 300;
const GAP_MS = 40;
const GROWN_LINES = 3750;
const SPREAD_FILES = 60;
const FINAL_LABEL = `${(GROWN_LINES + SPREAD_FILES * 2).toLocaleString('en-US')} lines added, 0 removed in ${SPREAD_FILES + 1} files`;
const API_STALL_MS = 200;

let repo: CrewRepo;

test.beforeEach(async () => {
  repo = crewRepo();
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => repo.remove());

async function startLiveDiff(page: Page, root: string): Promise<void> {
  const response = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${path.basename(root)}`) }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, 'Ask before edits');
  await page.keyboard.press('Escape');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(`Rewrite the live table #livediff ${EDITS} ${GAP_MS}ms`);
  await input.press('Enter');
}

function watchApi(page: Page) {
  const latencies: number[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const started = Date.now();
      await page.request.get('/api/health').catch(() => undefined);
      latencies.push(Date.now() - started);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  return async () => {
    running = false;
    await loop;
    return { probes: latencies.length, maxMs: Math.max(0, ...latencies) };
  };
}

function countChangeRequests(page: Page) {
  const counts = { summary: 0, pages: 0, diffs: 0 };
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/changes/summary')) counts.summary++;
    else if (url.includes('/changes/files')) counts.pages++;
    else if (url.includes('/changes/diff')) counts.diffs++;
  });
  return counts;
}

async function codeScrollTop(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelector<HTMLElement>('.dd-code .cm-scroller')?.scrollTop ?? -1,
  );
}

test('a live stream of edits keeps the chip, drawer and thread smooth', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests = countChangeRequests(page);
  await startLiveDiff(page, repo.root);
  const sent = Date.now();
  const chip = page.getByRole('button', { name: /lines? added, \d+ removed in [\d,]+ files?$/ });
  await expect(chip).toBeVisible({ timeout: 60_000 });

  const logs = markServerLogs();
  const stopApi = watchApi(page);
  await startProbe(page);
  const phases: Record<string, ProbeResult> = {};
  const clicks: Record<string, Cost> = {};
  const chipLabels = new Map<string, number>();
  const sampleChip = async () => {
    const label = await chip.getAttribute('aria-label').catch(() => null);
    if (label && !chipLabels.has(label)) chipLabels.set(label, Date.now() - sent);
  };

  for (let sample = 0; sample < 8; sample++) {
    await sampleChip();
    await page.waitForTimeout(250);
  }
  phases['thread while streaming'] = await takeProbe(page);

  clicks.openDrawer = await clickCost(chip);
  const drawer = page.getByRole('dialog', { name: /^Changes/ });
  const tree = drawer.getByRole('tree', { name: 'Changed files' });
  await expect(tree.getByRole('treeitem').first()).toBeVisible({ timeout: 30_000 });
  const filter = drawer.getByRole('searchbox', { name: 'Filter files' });
  await filter.fill('growing');
  const growing = tree.getByRole('treeitem', { name: /growing\.ts/ }).first();
  await expect(growing).toBeVisible({ timeout: 30_000 });
  clicks.pickGrowing = await clickCost(growing);
  await expect(drawer.locator('.dd-code .cm-content')).toContainText('row0 = compute', {
    timeout: 30_000,
  });
  phases['open drawer'] = await takeProbe(page);

  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.dd-code .cm-scroller')!.scrollTop = 600;
  });
  const parked = await codeScrollTop(page);
  const drift: number[] = [];
  for (let sample = 0; sample < 12; sample++) {
    await page.waitForTimeout(250);
    await sampleChip();
    drift.push(Math.abs((await codeScrollTop(page)) - parked));
  }
  phases['parked on growing file'] = await takeProbe(page);
  await filter.fill('');
  await expect(tree.getByRole('treeitem', { name: /module\d+\.ts/ }).first()).toBeVisible();

  for (let index = 0; index < 6; index++) {
    const item = tree.getByRole('treeitem', { name: /module\d+\.ts/ }).nth(index);
    if ((await item.count()) === 0) continue;
    clicks[`file${index}`] = await clickCost(item);
    await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.dd-tree-scroll');
      if (!scroller) return;
      for (let step = 0; step < 10; step++) {
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * (step / 9);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      scroller.scrollTop = 0;
    });
    await sampleChip();
  }
  phases['switch files while streaming'] = await takeProbe(page);

  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 120_000 });
  const doneAfterMs = Date.now() - sent;
  await expect(chip).toHaveAccessibleName(FINAL_LABEL, { timeout: 30_000 });
  await sampleChip();
  phases['finish'] = await takeProbe(page);
  const api = await stopApi();

  const warnings = lagWarningsSince(logs);

  await page.screenshot({ path: 'test-results/smooth-audit/live-diff.png' });
  const all = Object.values(phases);
  const summary = {
    edits: EDITS,
    requests,
    doneAfterMs,
    chipUpdates: chipLabels.size,
    chipLabels: Object.fromEntries(chipLabels),
    clicks,
    maxScrollDriftPx: Math.max(0, ...drift),
    longestTask: {
      wallMs: Math.max(...all.map((phase) => phase.longestTask.wallMs)),
      cpuMs: Math.max(...all.map((phase) => phase.longestTask.cpuMs)),
    },
    maxFrameGapMs: Math.max(...all.map((phase) => phase.maxFrameGapMs)),
    api,
    serverLagMs: lagMs(warnings),
    lagWarnings: warnings,
    phases,
  };
  test.info().annotations.push({ type: 'live diff perf', description: JSON.stringify(summary) });
  writeReport('live-diff', summary);

  expect(chipLabels.size).toBeGreaterThanOrEqual(3);
  expect(requests.summary).toBeLessThan(EDITS / 5);
  expect(requests.diffs).toBeLessThan(EDITS / 5);
  expect(summary.maxScrollDriftPx).toBeLessThan(2);
  for (const [name, click] of Object.entries(clicks)) {
    expectWithin(click, CLICK_LIMIT_MS, `${name} click to next paint`);
  }
  expectWithin(summary.longestTask, TASK_LIMIT_MS, 'longest task');
  expect(warnings).toEqual([]);
  expect(api.maxMs).toBeLessThan(API_STALL_MS);
});
