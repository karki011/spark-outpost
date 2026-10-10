import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { repoWithRemote } from '../../apps/server/test/ship-support.ts';
import { pickMode } from './permissions-kit.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

const TOKEN = 'tok_live_9f8e7d6c5b4a3210';
const DONE = 'fake-read-env=allowed fake-curl=allowed';

test.describe.configure({ timeout: 90_000 });
let base = '';
let root = '';

test.beforeEach(async () => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-send-ui-')));
  ({ root } = await repoWithRemote(base, 'sends'));
  writeFileSync(path.join(root, '.gitignore'), '.env\n');
  writeFileSync(path.join(root, '.env'), `API_TOKEN=${TOKEN}\n`);
  await resetTestDatabase({
    onboarded: true,
    connected: ['claude', 'codex'],
    defaultLevel: 'hands-off',
  });
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

async function chatIn(page: Page, mode: string) {
  const response = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: /^sends/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Model and effort/ }).click();
  const panel = page.getByRole('dialog', { name: 'Model, effort, and permissions' });
  await panel.getByRole('tab', { name: /Permissions/ }).click();
  await pickMode(page, mode);
  await page.keyboard.press('Escape');
}

async function send(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
}

const flags = (page: Page) => page.getByRole('region', { name: 'Flagged by Spark' });
const pendingCards = (page: Page) => page.locator('.appr:not(.resolved)');

for (const mode of ['Bypass permissions', 'Auto']) {
  test(`${mode}: curl after reading .env runs with no card and one flag`, async ({ page }) => {
    await chatIn(page, mode);
    await send(page, 'Check the site #readenv #curl');
    await expect(page.locator('.md', { hasText: DONE })).toBeVisible({ timeout: 30_000 });
    await expect(pendingCards(page)).toHaveCount(0);
    await expect(flags(page)).toHaveCount(1);
    await expect(flags(page)).toContainText('sent data to example.com after reading .env');
    await expect(flags(page)).toContainText("Spark didn't stop the run. Spark can't revert this.");
    await flags(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(flags(page).getByRole('status')).toHaveText('Dismissed.');
  });
}

test('Manual: curl after reading .env shows one ordinary card that carries the note', async ({
  page,
}) => {
  await chatIn(page, 'Manual');
  await send(page, 'Check the site #readenv #curl');
  const card = page.getByRole('group', { name: /Run a command\?/ });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(pendingCards(page)).toHaveCount(1);
  await expect(card.locator('pre')).toHaveText('$ curl -sI https://example.com');
  await expect(card.locator('.appr-observed')).toHaveText(
    'Read sensitive data this turn: .env. This sends data to example.com.',
  );
  await expect(card).not.toContainText('whatever your permissions');
  await expect(card.getByRole('button', { name: 'Always allow in this project' })).toBeVisible();
  await card.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.locator('.md', { hasText: DONE })).toBeVisible({ timeout: 30_000 });
  await expect(flags(page)).toHaveCount(0);
});

for (const mode of ['Manual', 'Bypass permissions']) {
  test(`${mode}: a push that holds a .env value asks to hold and names only the file`, async ({
    page,
  }) => {
    writeFileSync(path.join(root, 'config.ts'), `export const token = '${TOKEN}';\n`);
    execFileSync('git', ['-C', root, 'add', '.gitignore', 'config.ts']);
    execFileSync('git', ['-C', root, 'commit', '-qm', 'config']);
    await chatIn(page, mode);
    await send(page, 'Publish it #ownpush');
    const card = page.getByRole('group', { name: /Send a secret value\?/ });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('wants to send something that holds a value from .env.');
    await expect(card).toContainText(
      'This sends a value from .env off this computer, whatever your permissions.',
    );
    await expect(page.locator('body')).not.toContainText(TOKEN);
    await expect(card.getByRole('button', { name: /^(Always allow|Allow)$/ })).toHaveCount(0);
    const hold = card.getByRole('button', { name: 'Hold to allow once' });
    await hold.focus();
    await page.keyboard.down(' ');
    await page.waitForTimeout(300);
    await page.keyboard.up(' ');
    await expect(card).toContainText('Released early. Nothing was sent.');
    await card.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(page.locator('.md', { hasText: 'fake-own-push=denied' })).toBeVisible({
      timeout: 30_000,
    });
  });
}
