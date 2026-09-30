import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { repoWithRemote } from '../../apps/server/test/ship-support.ts';
import { pickPermission } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const SHOTS = process.env.SPARK_SHOTS ?? '';
const SKINS = [
  null,
  'light',
  'dark',
  'graphite',
  'apricot',
  'void',
  'fjord',
  'moss',
  'lagoon',
  'plum',
  'sage',
  'aurora',
  'iris',
  'contrast',
] as const;

test.describe.configure({ timeout: 90_000 });
let base = '';

test.beforeEach(async () => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-chat-terminal-ui-')));
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const dock = (page: Page) => page.getByRole('region', { name: 'Terminal' });
const screenText = (page: Page) => dock(page).locator('.xterm-accessibility');
const terminalButton = (page: Page) =>
  page.locator('.head-r').getByRole('button', { name: 'Terminal' });

async function shot(target: Page | Locator, name: string) {
  if (SHOTS) await target.screenshot({ path: path.join(SHOTS, `chat-terminal-${name}.png`) });
}

async function newChat(page: Page) {
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
}

async function newChatIn(page: Page, root: string) {
  const response = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(response.ok()).toBe(true);
  await newChat(page);
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: new RegExp(`^${path.basename(root)}`) }).click();
  await page.keyboard.press('Escape');
}

async function runPwd(page: Page, marker: string) {
  await expect(dock(page).locator('.term-light.open')).toBeVisible();
  await page.keyboard.type(`echo "${marker}:$(pwd)"`);
  await page.keyboard.press('Enter');
}

test('a chat without a project opens a terminal in the home folder', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  await newChat(page);
  const button = terminalButton(page);
  await expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+`');
  await button.hover();
  await expect(page.getByRole('tooltip')).toContainText('Terminal');

  await button.click();
  await expect(dock(page)).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(dock(page).getByRole('button', { name: '~', exact: true })).toBeVisible();
  await runPwd(page, 'home');
  await expect(screenText(page)).toContainText(`home:${realpathSync(os.homedir())}`);
  await shot(page, 'home');

  await page.keyboard.press('Control+Backquote');
  await expect(dock(page)).toHaveCount(0);
  await expect(button).toBeFocused();
  await page.keyboard.press('Control+Backquote');
  await expect(screenText(page)).toContainText('home:');
});

test('a project chat opens in its folder, keeps tabs while hidden and per chat', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  const root = path.join(base, 'widgets');
  mkdirSync(root);
  await newChatIn(page, root);
  await terminalButton(page).click();

  await expect(
    dock(page).getByRole('button', { name: 'my files · widgets', exact: true }),
  ).toBeVisible();
  await expect(dock(page).locator('.term-where')).toHaveText(root);
  await runPwd(page, 'project');
  await expect(screenText(page)).toContainText(`project:${root}`);

  await dock(page).getByRole('button', { name: 'New terminal' }).click();
  const tabs = dock(page).getByRole('group', { name: 'Terminals' });
  await expect(
    tabs.getByRole('button', { name: 'my files · widgets (2)', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'project-tabs');

  await tabs.getByRole('button', { name: 'Close my files · widgets (2)' }).click();
  await expect(tabs.getByRole('button', { name: /^my files · widgets/ })).toHaveCount(1);
  await expect(screenText(page)).toContainText(`project:${root}`);

  await dock(page).getByRole('button', { name: 'Hide terminal' }).click();
  await expect(dock(page)).toHaveCount(0);
  await expect(terminalButton(page)).toHaveClass(/running/);

  await page.getByRole('button', { name: 'New chat' }).first().click();
  await expect(terminalButton(page)).toHaveAttribute('aria-pressed', 'false');
  await terminalButton(page).click();
  await expect(dock(page).getByRole('button', { name: '~', exact: true })).toBeVisible();
  await expect(screenText(page)).not.toContainText('project:');
});

test('a Do chat with a worktree opens its terminal in the worktree', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  const repo = await repoWithRemote(base, 'gadgets');
  await newChatIn(page, repo.root);
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  await pickPermission(page, 'Ask before edits');
  await page.keyboard.press('Escape');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Add a line to the notes #edit #plan');
  await input.press('Enter');
  await page
    .getByRole('group', { name: /Change a file\?/ })
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 15_000 });
  const branch = (await page.locator('.head .chat-branch-name').textContent()) ?? '';
  expect(branch).toMatch(/^spark\//);

  await page.keyboard.press('Control+Backquote');
  await expect(
    dock(page).getByRole('button', { name: `${branch} · worktree`, exact: true }),
  ).toBeVisible();
  const chats = await page.request.get('/api/conversations');
  const [chat] = (await chats.json()) as { id: string }[];
  const workspace = await page.request.get(`/api/conversations/${chat!.id}/workspace`);
  const { current } = (await workspace.json()) as { current: { path: string } };
  expect(current.path).not.toBe(repo.root);
  await expect(dock(page).locator('.term-where')).toHaveText(current.path);
  await runPwd(page, 'worktree');
  await expect(screenText(page)).toContainText(`worktree:${realpathSync(current.path)}`);
  await shot(page, 'worktree');
});

test('the terminal panel has no serious contrast or ARIA issues in any theme', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1300, height: 860 });
  await newChat(page);
  await terminalButton(page).click();
  await expect(dock(page).locator('.term-light.open')).toBeVisible();
  await runPwd(page, 'a11y');
  await expect(screenText(page)).toContainText('a11y:');

  const found: { skin: string; rule: string; targets: string[] }[] = [];
  for (const skin of SKINS) {
    await page.evaluate((next) => {
      if (next) document.documentElement.dataset.skin = next;
      else delete document.documentElement.dataset.skin;
    }, skin);
    const results = await new AxeBuilder({ page })
      .include('#terminal-dock')
      .include('.head-r')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    for (const violation of results.violations) {
      if (violation.impact !== 'serious' && violation.impact !== 'critical') continue;
      found.push({
        skin: skin ?? 'system',
        rule: violation.id,
        targets: violation.nodes.map((node) => node.target.join(' ')),
      });
    }
    if (skin === 'graphite' || skin === 'apricot') await shot(dock(page), `panel-${skin}`);
  }
  expect(found).toEqual([]);
});

test('at phone width the terminal is a full-height sheet', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 860 });
  await newChat(page);
  await page.setViewportSize({ width: 390, height: 780 });
  await terminalButton(page).click();
  await expect(dock(page).locator('.term-light.open')).toBeVisible();
  const box = await dock(page).boundingBox();
  expect(box?.height).toBeGreaterThan(700);
  await expect(dock(page).getByRole('separator', { name: 'Resize terminal' })).toBeHidden();
  await shot(page, 'phone');
  await dock(page).getByRole('button', { name: 'Hide terminal' }).click();
  await expect(dock(page)).toHaveCount(0);
});
