import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { git, repoWithRemote } from '../../apps/server/test/ship-support.ts';
import { connectorCard, connectorHead, connectorStatus } from './connector-cards.ts';
import { pickPermission } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { FAKE_GH_STATE, STUB_PORT } from './stub-config.ts';

const GITHUB_DESCRIPTION =
  'Ship commits and pushes with your own Git. Opening a pull request needs GitHub.';

const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

test.describe.configure({ timeout: 90_000 });
let base = '';

test.beforeEach(async ({ request }) => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-ship-ui-')));
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await request.post(`${STUB_URL}/github-test/reset`);
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(FAKE_GH_STATE, { force: true });
});

async function keptChange(page: Page, root: string) {
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
  await input.fill('Add a line to the notes #edit #plan');
  await input.press('Enter');
  await page
    .getByRole('group', { name: /Change a file\?/ })
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await expect(page.getByRole('group', { name: /Keep these changes\?/ })).toContainText(
    'Kept: you approved every edit.',
  );
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 15_000 });
}

test('Ship from the keep card commits the task file and opens a PR', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const repo = await repoWithRemote(base, 'widgets');
  writeFileSync(path.join(repo.root, 'mine.txt'), 'my own edit\n');
  writeFileSync(FAKE_GH_STATE, 'octo-cli');
  await keptChange(page, repo.root);

  const open = page.locator('.ship-btn');
  await expect(open).toHaveText('Open PR');
  await expect(open).not.toHaveAttribute('aria-controls');
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  const panel = page.getByRole('group', { name: 'Ship this task' });
  await expect(panel).toHaveAttribute('id', (await open.getAttribute('aria-controls')) ?? '');
  await expect(panel.locator('.ship-facts')).toContainText(
    /Branch\s*spark\/add-a-line-to-the-notes/,
  );
  await expect(panel.locator('.ship-facts')).toContainText('into main');
  await expect(panel.getByRole('list', { name: 'Files to commit' })).toHaveText(/notes\.txt/);
  await expect(panel.getByRole('list', { name: 'Files to commit' })).not.toContainText('mine');
  await expect(panel.getByRole('radio', { name: 'PR', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const title = panel.getByLabel('Pull request title');
  await title.fill('Tidy the notes');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(open).toBeFocused();

  await open.click();
  await panel.getByLabel('Pull request title').fill('Tidy the notes');
  await panel.getByRole('button', { name: 'Open PR' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Opened PR #1.' })).toBeVisible({
    timeout: 15_000,
  });
  const chip = page.locator('.ship .lchip');
  await expect(chip).toContainText('acme/widgets#1');
  await expect(chip).toHaveAttribute('href', 'https://github.com/acme/widgets/pull/1');
  await expect(open).toHaveText('Update PR');
  await expect(open).toBeFocused();

  const pulls = (await (await page.request.get(`${STUB_URL}/github-test/pulls`)).json()) as {
    title: string;
    draft: boolean;
    base: string;
    head: string;
    via: string;
  }[];
  expect(pulls).toHaveLength(1);
  expect(pulls[0]).toMatchObject({ title: 'Tidy the notes', draft: false, base: 'main' });
  expect(pulls[0]!.via).toBe('gh_cli');
  await expect(page.locator('.ctxbar .chat-branch .ctx-branch-name')).toHaveText(pulls[0]!.head);
  expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  expect(git(repo.root, 'show', '--name-only', '--format=', pulls[0]!.head)).toBe('notes.txt');
  expect(git(repo.root, 'diff', '--name-only')).toBe('mine.txt');
  expect(git(repo.bare, 'rev-parse', pulls[0]!.head)).toBe(
    git(repo.root, 'rev-parse', pulls[0]!.head),
  );

  const showPanel = page.getByRole('button', { name: 'Show work panel' });
  if (await showPanel.isVisible()) await showPanel.click();
  const workPanel = page.getByRole('complementary', { name: 'Work panel' });
  await workPanel.getByRole('tab', { name: 'Changes' }).click();
  await expect(workPanel.locator('.ship .lchip')).toContainText('acme/widgets#1');
});

test('Ship offers push only when GitHub is not connected', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const repo = await repoWithRemote(base, 'pushonly');
  await keptChange(page, repo.root);
  const push = page.locator('.ship-btn');
  await expect(push).toHaveText('Push branch');
  await push.click();
  const panel = page.getByRole('group', { name: 'Ship this task' });
  await expect(panel).toContainText('Connect GitHub in Settings');
  await expect(panel.getByRole('radio')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Push branch' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Pushed spark\// })).toBeVisible({
    timeout: 15_000,
  });
  const branch = (await page.locator('.ctxbar .chat-branch .ctx-branch-name').textContent()) ?? '';
  expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  expect(git(repo.bare, 'rev-parse', branch)).toBe(git(repo.root, 'rev-parse', branch));
});

test('Full auto runs to a PR: the reply and the auto-kept card show the PR link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const repo = await repoWithRemote(base, 'fullauto');
  writeFileSync(path.join(repo.root, 'mine.txt'), 'my own edit\n');
  writeFileSync(FAKE_GH_STATE, 'octo-cli');
  const response = await page.request.post('/api/projects', { data: { rootPath: repo.root } });
  expect(response.ok()).toBe(true);
  await openChats(page);
  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  const menu = page.getByRole('dialog', { name: 'Project folders' });
  await menu.getByRole('button', { name: /^fullauto/ }).click();
  await page.keyboard.press('Escape');
  const button = page.getByRole('button', { name: /^Model and effort/ });
  await button.click();
  await pickPermission(page, 'Full auto');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Permissions: / })).toHaveAccessibleName(
    'Permissions: Bypass permissions',
  );
  await expect(page.getByRole('button', { name: /^Spark autonomy/ })).toHaveText('Full auto → PR');
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Add a line to the notes #edit #plan');
  await input.press('Enter');

  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 30_000 });
  await expect(page.getByRole('group', { name: /Change a file\?/ })).toHaveCount(0);
  const keep = page.getByRole('group', { name: /Keep these changes\?/ });
  await expect(keep).toContainText('Kept by Full auto → PR.');
  await expect(keep).toContainText('Opened PR #1: https://github.com/acme/widgets/pull/1');
  await expect(keep).toContainText(/The change is on spark\/\S+ in this chat's worktree\./);
  const chip = keep.locator('.ship .lchip');
  await expect(chip).toContainText('acme/widgets#1');
  await expect(chip).toHaveAttribute('href', 'https://github.com/acme/widgets/pull/1');

  const pulls = (await (await page.request.get(`${STUB_URL}/github-test/pulls`)).json()) as {
    draft: boolean;
    base: string;
    head: string;
  }[];
  expect(pulls).toHaveLength(1);
  expect(pulls[0]).toMatchObject({ draft: false, base: 'main' });
  expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  expect(git(repo.bare, 'diff', '--name-only', 'main', pulls[0]!.head)).toBe('notes.txt');
});

test('Settings shows the GitHub connection and saves, then removes, a token', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Connectors' }).click();
  const card = connectorCard(page, 'github');
  const status = connectorStatus(card);
  await expect(status).toHaveText(GITHUB_DESCRIPTION);
  await expect(card.locator('.pill-ok')).toHaveCount(0);
  await connectorHead(card).click();
  const methods = card.getByRole('radiogroup', { name: 'How to connect GitHub' });
  await expect(methods.getByRole('radio', { name: 'Personal token' })).toBeChecked();
  await methods.getByRole('radio', { name: 'gh CLI' }).click();
  await expect(card).toContainText('Installed but not signed in');
  await methods.getByRole('radio', { name: 'GitHub App' }).click();
  await expect(card.getByRole('region', { name: 'GitHub App' })).toContainText('Coming later');
  await methods.getByRole('radio', { name: 'Personal token' }).click();

  const token = card.getByLabel('Personal access token');
  await token.fill('not-a-token');
  await expect(card.getByRole('button', { name: 'Verify token' })).toBeDisabled();
  await token.fill('github_pat_rejected_0123456789abcdef');
  await card.getByRole('button', { name: 'Verify token' }).click();
  await expect(card.getByRole('alert')).toContainText('GitHub rejected this token');

  await token.fill('github_pat_11ABCDEFG0123456789_abcdefghijklmnop');
  await card.getByRole('button', { name: 'Verify token' }).click();
  await expect(status).toHaveText('Connected with a token as octo-token');
  await expect(card.locator('.pill-ok')).toHaveText('Connected');
  await expect(methods).toBeHidden();
  await connectorHead(card).click();
  await expect(card.locator('.gh-facts')).toContainText('Fine-grained token');
  await expect(card.locator('.gh-facts')).toContainText('2026');
  await expect(card).not.toContainText('github_pat_');

  await card.getByRole('button', { name: 'Remove token' }).click();
  await expect(status).toHaveText(GITHUB_DESCRIPTION);
  await expect(card.locator('.pill-ok')).toHaveCount(0);

  writeFileSync(FAKE_GH_STATE, 'octo-cli');
  await connectorHead(card).click();
  await methods.getByRole('radio', { name: 'gh CLI' }).click();
  await card.getByRole('button', { name: 'Check again' }).click();
  await expect(status).toHaveText('Connected through the gh CLI as octo-cli');
  await expect(methods.getByRole('radio', { name: 'gh CLI' })).toBeChecked();
  await expect(card).toContainText('Signed in as octo-cli');
  await expect(card.locator('.pill-ok')).toHaveText('Connected');
});
