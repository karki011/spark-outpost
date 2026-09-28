import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

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

async function editedChat(page: Page) {
  const response = await page.request.post('/api/projects', { data: { rootPath: appRoot } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${path.basename(appRoot)}`) }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const picker = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await picker.getByRole('tab', { name: /Permissions/ }).click();
  await picker
    .getByRole('radiogroup', { name: 'Permissions' })
    .getByRole('radio', { name: 'Ask before edits', exact: true })
    .click();
  await page.keyboard.press('Escape');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Tidy the notes #edit #plan');
  await input.press('Enter');
  await page
    .getByRole('group', { name: /Change a file\?/ })
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await expect(page.locator('.md', { hasText: 'fake-edit=allowed' })).toBeVisible({
    timeout: 15_000,
  });
  await page
    .getByRole('group', { name: /Keep these changes\?/ })
    .getByRole('button', { name: 'Keep', exact: true })
    .click();
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 15_000 });
}

const bigText = (lines: number, label: string) =>
  Array.from({ length: lines }, (_, index) => `${label} ${index}`).join('\n') + '\n';

const extraFiles = [
  {
    path: 'pnpm-lock.yaml',
    change: 'modified',
    added: 1200,
    removed: 340,
    oldText: 'lockfileVersion: 9\n',
    newText: 'lockfileVersion: 9.1\n',
    shown: 'text',
  },
  {
    path: 'src/generated-table.ts',
    change: 'added',
    added: 1240,
    removed: 0,
    oldText: null,
    newText: bigText(1240, 'row'),
    shown: 'text',
  },
  {
    path: 'data/huge.json',
    change: 'modified',
    added: 30_000,
    removed: 12,
    oldText: null,
    newText: null,
    shown: 'too-large',
    truncated: true,
  },
  {
    path: 'public/logo.png',
    change: 'modified',
    added: null,
    removed: null,
    oldText: null,
    newText: null,
    shown: 'binary',
  },
  {
    path: 'src/dates/format.ts',
    oldPath: 'src/format.ts',
    change: 'modified',
    added: 1,
    removed: 1,
    oldText: 'export const a = 1;\n',
    newText: 'export const a = 2;\n',
    shown: 'text',
  },
];

async function addLargeFiles(route: Route) {
  const response = await route.fetch();
  const body = (await response.json()) as { runs: { files: unknown[] }[] };
  body.runs[0]?.files.push(...extraFiles);
  await route.fulfill({ response, json: body });
}

async function fullFile(route: Route) {
  await route.fulfill({
    json: {
      path: 'data/huge.json',
      change: 'modified',
      added: 30_000,
      removed: 12,
      oldText: bigText(12, 'old'),
      newText: bigText(30_000, 'new'),
      shown: 'text',
    },
  });
}

test('a turn that changed files lists them and opens a diff inline', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await editedChat(page);
  const block = page.getByRole('region', { name: 'Files changed: 1 file changed' });
  await expect(block).toContainText('+1 −0');
  await expect(block.locator('.dstat i.a')).toHaveCount(1);
  await block.getByRole('button', { name: 'Open notes.txt' }).click();
  await expect(block.locator('.dv-row.add')).toHaveText('2+AddedEdited by the fake agent');
  await block.getByRole('button', { name: 'Close notes.txt' }).click();
  await expect(block.locator('.dv')).toHaveCount(0);

  await block.getByRole('button', { name: 'Review all changes' }).click();
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await expect(panel.getByRole('tab', { name: 'Changes' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel.getByRole('region', { name: /· 1 file$/ })).toContainText('notes.txt');
});

test('large, generated, binary and renamed files stay compact until asked', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.route('**/api/tasks/*/changes', addLargeFiles);
  await page.route('**/api/tasks/*/changes/file?*', fullFile);
  await editedChat(page);
  const block = page.getByRole('region', { name: 'Files changed: 6 files changed' });
  await expect(block.locator('.fchg-h')).toContainText('+32.4k −353');

  const lock = block.locator('.chf').filter({ hasText: 'pnpm-lock.yaml' });
  await expect(lock).toContainText('generated');
  await expect(lock).toContainText('+1.2k −340');
  await lock.getByRole('button', { name: 'Open pnpm-lock.yaml' }).click();
  await expect(lock).toContainText('Generated file · diff hidden');
  await expect(lock.locator('.dv')).toHaveCount(0);
  await lock.getByRole('button', { name: 'Show diff' }).click();
  await expect(lock.locator('.dv-row.add')).toHaveCount(1);

  const large = block.locator('.chf').filter({ hasText: 'generated-table.ts' });
  await large.getByRole('button', { name: 'Open src/generated-table.ts' }).click();
  await expect(large).toContainText('Large diff · 1,240 lines');
  await expect(large.locator('.dv')).toHaveCount(0);
  await large.getByRole('button', { name: 'Load diff' }).click();
  await expect(large.locator('.dv-row')).toHaveCount(300);
  await large.getByRole('button', { name: 'Show 300 of 940 more lines' }).click();
  await expect(large.locator('.dv-row')).toHaveCount(600);

  const huge = block.locator('.chf').filter({ hasText: 'huge.json' });
  await expect(huge).toContainText('+30k −12');
  await huge.getByRole('button', { name: 'Open data/huge.json' }).click();
  await expect(huge).toContainText('Large diff · 30,012 lines');
  await huge.getByRole('button', { name: 'Load diff' }).click();
  await expect(huge.locator('.dv-row').first()).toBeVisible();
  await expect(huge.locator('.dv-more')).toBeVisible();

  const logo = block.locator('.chf').filter({ hasText: 'logo.png' });
  await expect(logo).toContainText('Binary file changed');
  await expect(logo.getByRole('button')).toHaveCount(0);

  const renamed = block.locator('.chf').filter({ hasText: 'src/dates/format.ts' });
  await expect(renamed.locator('.chf-p')).toHaveText('src/format.ts → src/dates/format.ts');
  await expect(renamed).toContainText('renamed');
  await large.getByRole('button', { name: 'Close src/generated-table.ts' }).click();
  await huge.getByRole('button', { name: 'Close data/huge.json' }).click();
  await lock.getByRole('button', { name: 'Close pnpm-lock.yaml' }).click();
  await block.scrollIntoViewIfNeeded();
  await shot(page, 'thread');

  await page.setViewportSize({ width: 390, height: 844 });
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await shot(page, 'mobile');
});
