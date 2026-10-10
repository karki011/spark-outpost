import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { repoWithRemote } from '../../apps/server/test/ship-support.ts';
import { connectorCard, connectorHead } from './connector-cards.ts';
import { pickPermission } from './permissions-kit.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { FAKE_GH_STATE } from './stub-config.ts';
import { turnDone } from './project-chat-kit.ts';

test.describe.configure({ timeout: 90_000 });
let base = '';

test.beforeEach(async () => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-rails-ui-')));
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(FAKE_GH_STATE, { force: true });
});

async function linkProject(page: Page, root: string) {
  const response = await page.request.post('/api/projects', { data: { rootPath: root } });
  expect(response.ok()).toBe(true);
}

async function changeInChat(page: Page, root: string, text: string) {
  await linkProject(page, root);
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
  await input.fill(text);
  await input.press('Enter');
  await page
    .getByRole('group', { name: /Change a file\?/ })
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await turnDone(page, 30_000);
}

test('flags an instruction file the agent changed without asking, and reverts it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const repo = await repoWithRemote(base, 'rails');
  await changeInChat(page, repo.root, 'Add a line to the notes #edit #plan #agentsedit');

  const flag = page.getByRole('region', { name: 'Flagged by Spark' });
  await expect(flag).toContainText('changed agent instructions: AGENTS.md');
  await expect(flag).toContainText("Spark didn't stop the run.");
  await flag.getByRole('button', { name: 'Revert' }).click();
  await expect(flag.getByRole('status')).toHaveText('Reverted to before this run.');
  await expect(flag.getByRole('button', { name: 'Revert' })).toHaveCount(0);
});

test('the branch chip names how pull requests open', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const repo = await repoWithRemote(base, 'route');
  await changeInChat(page, repo.root, 'Add a line to the notes #edit #plan');
  const chip = page.locator('.ctxbar .chat-branch');
  await chip.hover();
  await expect(page.getByRole('tooltip')).toContainText('Push only · PR link');
});

test('Settings tests the pull request route without changing anything', async ({ page }) => {
  const repo = await repoWithRemote(base, 'tested');
  await linkProject(page, repo.root);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  const card = connectorCard(page, 'github');
  await connectorHead(card).click();
  const route = card.getByRole('region', { name: 'Pull request route' });
  await expect(route).toContainText('Pull requests: Push only · PR link');
  await route.getByRole('button', { name: 'Test' }).click();
  const results = route.getByRole('list', { name: 'Test results' });
  await expect(results).toContainText('tested · Push only · PR link');
  await expect(results).toContainText('Reached the remote with your git login');
});
