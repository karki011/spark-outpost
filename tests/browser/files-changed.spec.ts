import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { editedChat } from './edited-chat.ts';

const SHOTS = process.env.FILES_SHOTS ?? '';

let appRoot = '';

test.beforeEach(async () => {
  appRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-files-')));
  writeFileSync(path.join(appRoot, 'notes.txt'), 'Remember the milk\n');
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => rmSync(appRoot, { recursive: true, force: true }));

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const skin of ['graphite', 'apricot']) {
    await page.evaluate((value) => (document.documentElement.dataset.skin = value), skin);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `files-${name}-${skin}.png`) });
  }
}

const bigText = (lines: number, label: string) =>
  Array.from({ length: lines }, (_, index) => `${label} ${index}`).join('\n') + '\n';

const MB = 1024 * 1024;

const extraFiles = [
  {
    path: 'pnpm-lock.yaml',
    change: 'modified',
    added: 1200,
    removed: 340,
    shown: 'text',
    bytes: 4000,
  },
  {
    path: 'src/generated-table.ts',
    change: 'added',
    added: 1240,
    removed: 0,
    shown: 'text',
    bytes: 12_000,
  },
  {
    path: 'data/huge.json',
    change: 'modified',
    added: 30_000,
    removed: 12,
    shown: 'too-large',
    truncated: true,
    bytes: 3 * MB,
  },
  {
    path: 'public/logo.png',
    change: 'modified',
    added: null,
    removed: null,
    shown: 'binary',
    bytes: 24 * 1024,
  },
  {
    path: 'src/dates/format.ts',
    oldPath: 'src/format.ts',
    change: 'modified',
    added: 1,
    removed: 1,
    shown: 'text',
    bytes: 20,
  },
];

const extraAdded = 1200 + 1240 + 30_000 + 1;
const extraRemoved = 340 + 12 + 1;

async function addToSummary(route: Route) {
  const response = await route.fetch();
  const body = (await response.json()) as {
    files: number;
    added: number;
    removed: number;
    runs: { files: number; added: number; removed: number }[];
  };
  const run = body.runs[0];
  if (!run) return route.fulfill({ response, json: body });
  body.files += extraFiles.length;
  body.added += extraAdded;
  body.removed += extraRemoved;
  run.files += extraFiles.length;
  run.added += extraAdded;
  run.removed += extraRemoved;
  await route.fulfill({ response, json: body });
}

async function addToPage(route: Route) {
  const response = await route.fetch();
  const body = (await response.json()) as {
    total: number;
    files: { runId: string; path: string }[];
    folders: { path: string; start: number; count: number }[];
  };
  const runId = body.files[0]?.runId;
  if (!runId) return route.fulfill({ response, json: body });
  body.files.push(...extraFiles.map((file) => ({ ...file, runId })));
  body.files.sort((a, b) => (a.path < b.path ? -1 : 1));
  body.total = body.files.length;
  body.folders = body.files.map((file, index) => ({
    path: file.path.split('/').slice(0, -1).join('/'),
    start: index,
    count: 1,
  }));
  await route.fulfill({ response, json: body });
}

async function extraDiff(route: Route) {
  const url = new URL(route.request().url());
  const file = extraFiles.find((extra) => extra.path === url.searchParams.get('path'));
  if (!file) return route.fallback();
  const lines = Number(url.searchParams.get('lines')) || null;
  const total = file.path === 'data/huge.json' ? 30_000 : 1240;
  const shown = lines ? Math.min(lines, total) : total;
  await route.fulfill({
    json: {
      ...file,
      runId: url.searchParams.get('runId'),
      oldText: file.change === 'added' ? null : bigText(12, 'old'),
      newText: bigText(shown, 'new'),
      oldLines: file.change === 'added' ? 0 : 12,
      newLines: total,
      limited: shown < total,
    },
  });
}

test('a turn lists changed files and opens each one in the diff drawer', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await editedChat(page, appRoot);
  await expect(page.getByRole('group', { name: /Keep these changes\?/ })).toContainText(
    'Kept automatically.',
    { timeout: 20_000 },
  );
  const block = page.getByRole('region', { name: 'Files changed: 1 file changed' });
  await expect(block).toContainText('+1 −0');
  await expect(block.locator('.dstat i.a')).toHaveCount(1);
  await block.getByRole('button', { name: 'Open the diff of notes.txt' }).click();
  const drawer = page.getByRole('dialog', { name: 'Changes · 1 file' });
  await expect(drawer.getByRole('region', { name: 'Diff of notes.txt' })).toBeVisible();
  await expect(drawer.locator('.cm-content')).toContainText('Edited by the fake agent');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(block.getByRole('button', { name: 'Open the diff of notes.txt' })).toBeFocused();

  await block.getByRole('button', { name: 'Review all changes' }).click();
  await expect(page.getByRole('dialog', { name: 'Changes · 1 file' })).toBeVisible();
  await page.getByRole('button', { name: 'Close changes' }).click();

  const show = page.getByRole('button', { name: 'Show work panel' });
  if (await show.isVisible()) await show.click();
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await panel.getByRole('tab', { name: 'Changes' }).click();
  await expect(panel.getByRole('region', { name: 'Most changed files' })).toContainText(
    'notes.txt',
  );
  await expect(panel.getByRole('region', { name: 'By run' })).toContainText('1 file');
  await panel.getByRole('button', { name: 'Open diff' }).click();
  await expect(page.getByRole('dialog', { name: 'Changes · 1 file' })).toBeVisible();
});

test('generated, huge, binary and renamed files stay compact until asked', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.route('**/api/tasks/*/changes/summary', addToSummary);
  await page.route('**/api/tasks/*/changes/files?*', addToPage);
  await page.route('**/api/tasks/*/changes/diff?*', extraDiff);
  await editedChat(page, appRoot);
  const block = page.getByRole('region', { name: 'Files changed: 6 files changed' });
  await expect(block.locator('.fchg-h')).toContainText('+32.4k −353');
  const lock = block.locator('.chf').filter({ hasText: 'pnpm-lock.yaml' });
  await expect(lock).toContainText('generated');
  await expect(lock).toContainText('+1.2k −340');
  await expect(block.locator('.chf').filter({ hasText: 'logo.png' })).toContainText(
    'Binary file changed',
  );
  const renamed = block.locator('.chf').filter({ hasText: 'src/dates/format.ts' });
  await expect(renamed.locator('.chf-p')).toHaveText('src/format.ts → src/dates/format.ts');
  await expect(renamed).toContainText('renamed');
  await shot(page, 'thread');

  await lock.getByRole('button', { name: 'Open the diff of pnpm-lock.yaml' }).click();
  const drawer = page.getByRole('dialog', { name: /^Changes · 6 files/ });
  await expect(drawer).toContainText('Generated file · diff hidden');
  await drawer.getByRole('button', { name: 'Show diff' }).click();
  await expect(drawer.locator('.cm-content')).toContainText('new 0');

  const tree = drawer.getByRole('tree', { name: 'Changed files' });
  await tree.getByRole('treeitem', { name: /huge\.json/ }).click();
  await expect(drawer).toContainText('Large file · 3 MB · diff hidden');
  await drawer.getByRole('button', { name: 'Show diff' }).click();
  await expect(drawer.getByRole('status')).toContainText(
    'Showing the first 2,000 lines of 30,000 lines.',
  );
  await drawer.getByRole('button', { name: 'Load full file' }).click();
  await expect(drawer.getByRole('button', { name: 'Load full file' })).toHaveCount(0);

  await tree.getByRole('treeitem', { name: /logo\.png/ }).click();
  await expect(drawer).toContainText('Binary file changed · 24 KB');
  await expect(drawer.getByRole('button', { name: 'Show diff' })).toHaveCount(0);
  await shot(page, 'drawer');

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await shot(page, 'mobile');
});
