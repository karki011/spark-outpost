import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resetTestDatabase } from './database.ts';

const SHOTS = process.env.M2_SCREENSHOTS ?? '';
const THEMES = [
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'contrast',
  'system',
];

let base = '';
let appRoot = '';
const notes = () => path.join(appRoot, 'notes.txt');

test.beforeAll(() => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-approvals-')));
  appRoot = path.join(base, 'app');
  mkdirSync(appRoot);
});

test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test.beforeEach(async () => {
  writeFileSync(notes(), 'Remember the milk\n');
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, `m2-${name}.png`) });
}

async function doChat(page: Page) {
  const response = await page.request.post('/api/projects', { data: { rootPath: appRoot } });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: /^app/ }).click();
  await expect(menu.getByRole('list', { name: 'Linked repos' })).toContainText('app');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await expect(panel.getByRole('radio', { name: /Fake Fast/ })).toBeVisible();
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await panel.getByRole('radio', { name: /^Do/ }).click();
  const levels = panel.getByRole('radiogroup', { name: 'Involvement level' });
  await expect(levels.getByRole('radio', { name: /^Balanced/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(panel.getByRole('tab', { name: /Permissions/ })).toContainText('Do · Balanced');
  await shot(page, 'level-picker');
  await page.keyboard.press('Escape');
  return page.getByRole('textbox', { name: 'Message' });
}

async function send(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

const card = (page: Page, name: RegExp) => page.getByRole('group', { name });

test('asks before a command and runs it after Allow, from the keyboard', async ({ page }) => {
  await doChat(page);
  await send(page, 'Run the tests #approve');
  const approval = card(page, /Run a command\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  await expect(approval.locator('pre')).toHaveText('$ pnpm test -- groupMessages');
  await expect(approval).toContainText("Commands aren't sandboxed");
  await expect(page.locator('.mood')).toHaveText('waiting for you');
  await expect(page.locator('.ai-avatar.waiting')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await shot(page, 'approval-command');

  await page.reload();
  await expect(card(page, /Run a command\?/)).toBeVisible();
  const allow = card(page, /Run a command\?/).getByRole('button', { name: 'Allow', exact: true });
  await allow.focus();
  await page.keyboard.press('Enter');
  await expect(card(page, /Run a command\?/).getByRole('status')).toContainText('Allowed once.');
  await expect(page.locator('.md', { hasText: 'Done. fake-run=allowed' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: /Worked for|steps/ }).click();
  await expect(page.getByText('(you allowed it)')).toBeVisible();
});

test('shows the diff for an edit and leaves the file alone after Deny', async ({ page }) => {
  const original = Array.from({ length: 30 }, (_, index) => `Note ${index + 1}`).join('\n');
  writeFileSync(notes(), `${original}\n`);
  await doChat(page);
  await send(page, 'Tidy the notes #edit');
  const approval = card(page, /Change a file\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  const figure = approval.getByRole('figure');
  await expect(figure).toContainText('notes.txt');
  await expect(figure.locator('.appr-count')).toHaveText('+1 −0');
  await expect(figure.getByText('New file')).toHaveCount(0);
  const added = figure.locator('.dv-row.add');
  await expect(added).toHaveText('31+AddedEdited by the fake agent');
  const rows = figure.locator('.dv-row');
  await expect(rows).toHaveCount(4);
  await figure.getByRole('button', { name: 'Show 27 unchanged lines' }).click();
  await expect(rows).toHaveCount(31);
  await expect(rows.first()).toHaveText('11 Note 1');
  const wrap = figure.getByRole('button', { name: 'Wrap' });
  await expect(wrap).toHaveAttribute('aria-pressed', 'false');
  await wrap.click();
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');
  await expect(figure.getByRole('region', { name: 'Changes to notes.txt' })).toHaveClass(/wrap/);
  await expect(approval.getByRole('button', { name: 'Always allow in this project' })).toHaveCount(
    0,
  );
  await shot(page, 'approval-edit');
  await approval.getByRole('button', { name: 'Deny' }).click();
  await expect(page.locator('.md', { hasText: 'fake-edit=denied' })).toBeVisible({
    timeout: 15_000,
  });
  expect(readFileSync(notes(), 'utf8')).toBe(`${original}\n`);
});

test('marks a new file in the diff', async ({ page }) => {
  rmSync(notes());
  await doChat(page);
  await send(page, 'Start the notes #edit');
  const approval = card(page, /Change a file\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  const figure = approval.getByRole('figure');
  await expect(figure.getByText('New file')).toBeVisible();
  await expect(figure.locator('.dv-row.add')).toHaveText('1+AddedEdited by the fake agent');
  await approval.getByRole('button', { name: 'Deny' }).click();
  await expect(page.locator('.md', { hasText: 'fake-edit=denied' })).toBeVisible({
    timeout: 15_000,
  });
});

test('"Always allow in this project" adds the command to the allowlist', async ({ page }) => {
  await doChat(page);
  await send(page, 'Run the tests #approve');
  await card(page, /Run a command\?/)
    .getByRole('button', { name: 'Always allow in this project' })
    .click();
  await expect(page.locator('.md', { hasText: 'fake-run=allowed' })).toBeVisible({
    timeout: 15_000,
  });

  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: /Commands that run without asking/ }).click();
  const list = menu.getByRole('list', { name: 'Allowed commands in app' });
  await expect(list).toContainText('pnpm test -- groupMessages');
  await shot(page, 'allowlist');
  await page.keyboard.press('Escape');

  await send(page, 'Again #approve');
  await expect(page.locator('.md', { hasText: 'Done. fake-run=allowed' }).nth(1)).toBeVisible({
    timeout: 15_000,
  });
  await expect(card(page, /Run a command\?/)).toHaveCount(0);

  await page.locator('.ctx-repo').click();
  await expect(
    menu.getByRole('button', { name: /Commands that run without asking/ }),
  ).toHaveAttribute('aria-expanded', 'true');
  await list.getByRole('button', { name: 'Remove pnpm test -- groupMessages' }).click();
  await expect(list).toHaveCount(0);
});

test('Stop while waiting cancels the approval and the run', async ({ page }) => {
  await doChat(page);
  await send(page, 'Run the tests #approve');
  await expect(card(page, /Run a command\?/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('.mood', { hasText: 'stopped' })).toBeVisible({ timeout: 15_000 });
  await expect(card(page, /Run a command\?/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('reverts an allowed edit after one confirmation', async ({ page }) => {
  await doChat(page);
  await send(page, 'Tidy the notes #edit');
  await card(page, /Change a file\?/)
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await expect(page.locator('.md', { hasText: 'fake-edit=allowed' })).toBeVisible({
    timeout: 15_000,
  });
  expect(readFileSync(notes(), 'utf8')).toContain('Edited by the fake agent');
  const keep = card(page, /Keep these changes\?/);
  await keep.getByRole('button', { name: 'View changes' }).click();
  const panel = page.getByRole('complementary', { name: 'Work panel' });
  await expect(panel.getByRole('tab', { name: 'Changes' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const changed = panel.getByRole('region', { name: /· 1 file$/ });
  await expect(changed).toContainText('notes.txt');
  await expect(changed).toContainText('+1 −0');
  await changed.getByRole('button', { name: 'Open notes.txt' }).click();
  await expect(changed.locator('.dv-row.add')).toHaveText('2+AddedEdited by the fake agent');
  await shot(page, 'changes-tab');
  await keep.getByRole('button', { name: 'Keep', exact: true }).click();

  await page.getByRole('button', { name: 'Revert to before this run' }).click();
  const confirm = page.getByRole('group', { name: 'Revert to before this run' });
  await expect(confirm).toContainText('Revert 1 file?');
  await expect(confirm.getByRole('listitem')).toHaveText('notes.txt changed');
  await expect(confirm.getByRole('button', { name: 'Revert', exact: true })).toBeFocused();
  await shot(page, 'revert-confirm');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Reverted 1 file.')).toBeVisible();
  expect(readFileSync(notes(), 'utf8')).toBe('Remember the milk\n');
});

test('Codex shows Do as unavailable with the reason', async ({ page }) => {
  await doChat(page);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await panel.getByRole('tab', { name: 'Codex' }).click();
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await expect(panel.getByRole('radio', { name: /^Do/ })).toHaveCount(1);
  const codexDo = panel.getByRole('radio', { name: /^Do/ });
  await expect(codexDo).toHaveAttribute('aria-disabled', 'true');
  await expect(codexDo).toContainText("Codex can't ask before each command yet");
  await codexDo.click({ force: true });
  await expect(panel.getByRole('radio', { name: /^Ask/ })).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'codex-unavailable');
});

test('the approval card works on a phone and in every theme', async ({ page }) => {
  test.setTimeout(60_000);
  await doChat(page);
  await send(page, 'Run the tests #approve');
  const approval = card(page, /Run a command\?/);
  await expect(approval).toBeVisible({ timeout: 15_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await approval.scrollIntoViewIfNeeded();
  const box = await approval.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await shot(page, 'mobile');
  await page.setViewportSize({ width: 1100, height: 760 });
  for (const theme of THEMES) {
    await page.evaluate((skin) => {
      if (skin === 'system') delete document.documentElement.dataset.skin;
      else document.documentElement.dataset.skin = skin;
    }, theme);
    await expect(approval).toBeVisible();
    await shot(page, `theme-${theme}`);
  }
  await approval.getByRole('button', { name: 'Deny' }).click();
});
