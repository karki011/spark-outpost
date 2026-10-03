import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { git, repoWithRemote } from '../../apps/server/test/ship-support.ts';
import { pickPermission } from './crew-engine.ts';
import { resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';

test.describe.configure({ timeout: 90_000 });
let base = '';

test.beforeEach(async () => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-chat-worktree-ui-')));
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

async function chatOn(page: Page, root: string) {
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
}

async function sendAndKeep(page: Page) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill('Add a line to the notes #edit #plan');
  await input.press('Enter');
  await page
    .getByRole('group', { name: /Change a file\?/ })
    .getByRole('button', { name: 'Allow', exact: true })
    .click();
  await expect(page.getByRole('group', { name: /Keep these changes\?/ })).toContainText(
    'Kept: you approved every edit.',
    { timeout: 20_000 },
  );
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 15_000 });
}

test('a Do chat works on its own branch in a worktree and brings the change in on request', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const repo = await repoWithRemote(base, 'widgets');
  await chatOn(page, repo.root);
  const place = page.getByRole('button', { name: /^Where this chat works/ });
  await expect(place).toHaveText(/New branch/);
  await place.click();
  const menu = page.getByRole('dialog', { name: 'Where this chat works' });
  await expect(menu.getByRole('button', { name: /^New branch/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(menu.getByRole('button', { name: /Edit my files directly/ })).toBeVisible();
  await expect(menu.getByRole('radio', { name: /^main/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(place).toBeFocused();

  await sendAndKeep(page);
  const chip = page.getByRole('button', { name: /^This chat’s branch/ });
  await expect(chip).toContainText(/spark\/add-a-line-to-the-notes[a-z-]*-[0-9a-f]{8}/);
  await expect(chip).toContainText('· worktree');
  await expect(page.locator('.head .chat-branch')).toHaveCount(0);
  await expect(place).toHaveCount(0);
  await chip.click();
  const branchMenu = page.getByRole('dialog', { name: 'This chat’s branch' });
  await expect(branchMenu).toContainText('Where this chat works is set once it has a branch.');
  await expect(branchMenu.getByRole('button', { name: 'Open the worktree folder' })).toBeVisible();
  await expect(branchMenu.getByRole('button', { name: 'Copy branch name' })).toBeVisible();
  await expect(branchMenu.getByRole('button', { name: 'Bring changes into main' })).toBeVisible();
  if (process.env.SPARK_SHOTS) {
    await page.screenshot({ path: `${process.env.SPARK_SHOTS}/docked-branch-menu.png` });
  }
  await page.keyboard.press('Escape');
  await expect(chip).toBeFocused();
  const branch = (await chip.locator('.ctx-branch-name').textContent()) ?? '';
  expect(readFileSync(path.join(repo.root, 'notes.txt'), 'utf8')).toBe('one\n');
  expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe('main');

  const keep = page.getByRole('group', { name: /Keep these changes\?/ });
  await expect(keep).toContainText(`Kept on ${branch} in this chat’s worktree.`);
  await expect(keep.locator('.ship-btn')).toHaveText('Push branch');
  await keep.getByRole('button', { name: 'Bring changes into main' }).click();
  const done = page.getByRole('status').filter({ hasText: 'Brought 1 file into main.' });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
  expect(readFileSync(path.join(repo.root, 'notes.txt'), 'utf8')).not.toBe('one\n');
  expect(git(repo.root, 'diff', '--name-only')).toBe('notes.txt');
  expect(git(repo.root, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
});

test('Edit my files changes the checked-out branch and is remembered for the project', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const repo = await repoWithRemote(base, 'inplace');
  await chatOn(page, repo.root);
  const place = page.getByRole('button', { name: /^Where this chat works/ });
  await place.click();
  await page
    .getByRole('dialog', { name: 'Where this chat works' })
    .getByRole('button', { name: /Edit my files directly/ })
    .click();
  await expect(place).toHaveText(/main · my files/);
  await expect(
    page.getByRole('dialog', { name: 'Where this chat works' }).getByRole('button', {
      name: /Editing your files directly/,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(place).toBeFocused();
  await sendAndKeep(page);
  await expect(page.locator('.head .chat-branch')).toHaveCount(0);
  await expect(page.locator('.bring')).toHaveCount(0);
  expect(readFileSync(path.join(repo.root, 'notes.txt'), 'utf8')).not.toBe('one\n');
  expect(git(repo.root, 'worktree', 'list')).not.toContain('.spark');

  await page.getByRole('button', { name: 'New chat' }).first().click();
  await page.locator('.ctx-repo').click();
  await page
    .getByRole('dialog', { name: 'Project folders' })
    .getByRole('button', { name: /^inplace/ })
    .click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Where this chat works/ })).toHaveText(
    /main · my files/,
  );
});
