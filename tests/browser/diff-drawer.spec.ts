import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { crewRepo, type CrewRepo } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import { editedChat } from './edited-chat.ts';

test.use({ trace: 'off' });

const PRODUCTION = Boolean(process.env.SPARK_WEB_BUILD);
const BUSY_MACHINE = (os.loadavg()[0] ?? 0) > os.cpus().length * 2;
const LONG_TASK_MS = PRODUCTION && !BUSY_MACHINE ? 100 : 250;
const FILES = 5000;
const BIG_LINES = 20_000;
const SHOTS = 'test-results/diff-drawer';

let repo: CrewRepo;

test.beforeEach(async () => {
  repo = crewRepo();
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => repo.remove());

function writeChangeSet(root: string) {
  for (let index = 0; index < FILES; index++) {
    const folder = path.join(root, 'src', `area${index % 50}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      path.join(folder, `file${index}.ts`),
      `export const value${index} = ${index};\nexport const label${index} = 'file ${index}';\n`,
    );
  }
  const big = Array.from(
    { length: BIG_LINES },
    (_, index) => `export const row${index} = compute(${index}, 'row ${index} of the table');`,
  );
  mkdirSync(path.join(root, 'src', 'huge'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'huge', 'table.ts'), `${big.join('\n')}\n`);
}

interface Perf {
  long: number[];
}

async function watchLongTasks(page: Page) {
  await page.evaluate(() => {
    const record: Perf = { long: [] };
    (window as unknown as { diffPerf: Perf }).diffPerf = record;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record.long.push(Math.round(entry.duration));
    }).observe({ type: 'longtask' });
  });
}

async function longTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { diffPerf: Perf }).diffPerf.long);
}

async function scrollThrough(page: Page, selector: string, steps: number) {
  await page.evaluate(
    async ({ selector, steps }) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Nothing matches ${selector}`);
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const end = () => element.scrollHeight - element.clientHeight;
      for (let step = 1; step <= steps; step++) {
        element.scrollTop = (end() * step) / steps;
        await frame();
        await frame();
      }
      for (let step = steps - 1; step >= 0; step--) {
        element.scrollTop = (end() * step) / steps;
        await frame();
        await frame();
      }
    },
    { selector, steps },
  );
}

async function nodeCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('*').length);
}

test('a 5,000 file change set with a 20,000 line file opens and scrolls without long tasks', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await editedChat(page, repo.root);
  writeChangeSet(repo.work());
  await page.reload();
  const chip = page.getByRole('button', { name: /lines added, \d+ removed in 5,002 files$/ });
  await expect(chip).toBeVisible({ timeout: 180_000 });
  await expect(chip).toHaveAccessibleName('30,001 lines added, 0 removed in 5,002 files');
  const drawer = page.getByRole('dialog', { name: /^Changes · 5,002 files$/ });
  const tree = drawer.getByRole('tree', { name: 'Changed files' });
  const loadedRow = tree.locator('.dd-row.dd-file:not([aria-busy])').first();
  if (!PRODUCTION) {
    await chip.click();
    await expect(loadedRow).toBeVisible({ timeout: 90_000 });
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  }
  const baseline = await nodeCount(page);
  await watchLongTasks(page);
  const phases: Record<string, number[]> = {};
  let seen = 0;
  const phase = async (name: string) => {
    const all = await longTasks(page);
    phases[name] = all.slice(seen);
    seen = all.length;
  };
  const shoot = async (name: string) => {
    await phase(`before ${name}`);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await phase(`screenshot ${name}`);
  };

  await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < 600; index++) await frame();
  });
  await phase('idle chat for 600 frames');
  const opened = Date.now();
  await chip.click();
  await expect(loadedRow).toBeVisible({ timeout: 30_000 });
  const openMs = Date.now() - opened;
  await expect(tree).toBeFocused();
  await shoot('drawer-open');

  await scrollThrough(page, '.dd-tree-scroll', 40);
  await phase('scroll file list');
  expect(await tree.locator('.dd-row').count()).toBeLessThan(80);

  await drawer.getByRole('searchbox', { name: 'Filter files' }).fill('huge/table');
  await tree.getByRole('treeitem', { name: /table\.ts/ }).click();
  await expect(drawer).toContainText('Large file · 1.2 MB · diff hidden');
  await phase('filter and select');
  await drawer.getByRole('button', { name: 'Show diff' }).click();
  await expect(drawer.getByRole('status')).toContainText(
    'Showing the first 2,000 lines of 20,000 lines.',
    { timeout: 30_000 },
  );
  await expect(drawer.locator('.cm-content')).toContainText('row0 = compute(0', {
    timeout: 30_000,
  });
  await phase('show first 2,000 lines');
  await scrollThrough(page, '.dd-code .cm-scroller', 30);
  await phase('scroll first 2,000 lines');
  await shoot('drawer-big-file');

  await drawer.getByRole('button', { name: 'Load full file' }).click();
  await expect(drawer.getByRole('button', { name: 'Load full file' })).toHaveCount(0, {
    timeout: 30_000,
  });
  await phase('load full file');
  await scrollThrough(page, '.dd-code .cm-scroller', 60);
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.dd-code .cm-scroller')!;
    scroller.scrollTop = scroller.scrollHeight;
  });
  await expect(drawer.locator('.cm-content')).toContainText(`row${BIG_LINES - 1} = compute`);
  await phase('scroll full file');
  await shoot('drawer-big-file-end');

  const lines = await drawer.locator('.cm-line').count();
  const nodes = await nodeCount(page);
  const long = Object.entries(phases)
    .filter(([name]) => !name.startsWith('screenshot') && !name.startsWith('idle'))
    .flatMap(([, tasks]) => tasks);
  console.log(JSON.stringify(phases));
  test.info().annotations.push({
    type: 'diff drawer perf',
    description: JSON.stringify({
      production: PRODUCTION,
      loadAverage: os.loadavg()[0],
      limitMs: LONG_TASK_MS,
      openMs,
      longTasks: long.length,
      maxLongTaskMs: Math.max(0, ...long),
      idleMaxLongTaskMs: Math.max(0, ...(phases['idle chat for 600 frames'] ?? [])),
      domNodesBefore: baseline,
      domNodesAfter: nodes,
      editorLines: lines,
      phases,
    }),
  });
  expect(lines).toBeLessThan(400);
  expect(nodes - baseline).toBeLessThan(4000);
  expect(Math.max(0, ...long)).toBeLessThan(LONG_TASK_MS);

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(chip).toBeFocused();
});

test('the changes chip opens the drawer by shortcut, resizes and hands focus back', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await editedChat(page, repo.root);
  const chip = page.getByRole('button', { name: '1 line added, 0 removed in 1 file' });
  await expect(chip).toBeVisible({ timeout: 60_000 });
  await expect(chip).toContainText('+1−0');

  await page.getByRole('textbox', { name: 'Message' }).focus();
  await page.keyboard.press('ControlOrMeta+Shift+D');
  const drawer = page.getByRole('dialog', { name: 'Changes · 1 file' });
  await expect(drawer).toBeVisible();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  const tree = drawer.getByRole('tree', { name: 'Changed files' });
  await expect(tree).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(drawer.getByRole('region', { name: 'Diff of notes.txt' })).toBeVisible();
  await drawer.getByRole('radio', { name: 'Split' }).click();
  await expect(drawer.locator('.cm-mergeView')).toBeVisible();
  await drawer.getByRole('button', { name: 'Wrap' }).click();
  await expect(drawer.getByRole('button', { name: 'Wrap' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const handle = drawer.getByRole('separator', { name: 'Resize changes drawer' });
  const before = (await drawer.boundingBox())!.width;
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => Math.round((await drawer.boundingBox())!.width))
    .toBe(Math.round(before + 24));
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 103, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await drawer.boundingBox())!.width))
    .toBe(Math.round(before - 76));
  const threadBox = await page.locator('.thread-wrap, .thread').first().boundingBox();
  expect(threadBox?.width ?? 0).toBeGreaterThan(400);

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(chip).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ControlOrMeta+Shift+D');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Close changes' }).click();
  await expect(drawer).toHaveCount(0);
});
