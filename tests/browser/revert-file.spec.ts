import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { resetTestDatabase } from './database.ts';
import { editedChat } from './edited-chat.ts';
import { chatRepo, type ChatRepo } from './project-chat-kit.ts';

let repo: ChatRepo;

test.beforeEach(async () => {
  repo = chatRepo();
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
});

test.afterEach(() => repo.remove());

test('Revert file undoes one file of a run from the Changes drawer, by keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await editedChat(page, repo.root);
  expect(repo.notes()).not.toBe('start\n');
  writeFileSync(path.join(repo.work(), 'later.txt'), 'written after the run\n');
  await page.reload();

  const chip = page.getByRole('button', { name: /lines added, \d+ removed in 2 files$/ });
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await chip.click();
  const drawer = page.getByRole('dialog', { name: /^Changes/ });
  await expect(drawer).toHaveAccessibleName('Changes · 2 files');
  const tree = drawer.getByRole('tree', { name: 'Changed files' });
  await expect(tree).toBeFocused();

  await tree.getByRole('treeitem', { name: /later\.txt/ }).click();
  await drawer.getByRole('button', { name: 'Revert file' }).click();
  const refused = drawer.getByRole('group', { name: 'Revert later.txt' });
  await expect(refused).toContainText('changed after this run');
  await expect(refused.getByRole('button', { name: 'Revert file' })).toHaveCount(0);
  await refused.getByRole('button', { name: 'Close' }).click();

  await tree.getByRole('treeitem', { name: /notes\.txt/ }).click();
  const opener = drawer.getByRole('button', { name: 'Revert file' });
  await tree.focus();
  for (let press = 0; press < 8; press++) {
    await page.keyboard.press('Tab');
    if (await opener.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');
  const confirm = drawer.getByRole('group', { name: 'Revert notes.txt' });
  await expect(confirm).toContainText('Restores it to how it was before this run.');
  await expect(confirm.getByRole('button', { name: 'Revert file' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(opener).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(confirm.getByRole('button', { name: 'Revert file' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(drawer.getByRole('status').filter({ hasText: 'Reverted notes.txt.' })).toHaveCount(
    1,
  );
  await expect(tree).toBeFocused();
  await expect(drawer).toHaveAccessibleName('Changes · 1 file');
  await expect(tree.getByRole('treeitem', { name: /notes\.txt/ })).toHaveCount(0);
  await expect(tree.getByRole('treeitem', { name: /later\.txt/ })).toBeVisible();
  expect(repo.notes()).toBe('start\n');
  expect(repo.file('later.txt')).toBe('written after the run\n');
  await page.screenshot({ path: 'test-results/revert-file/after-revert.png' });

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});
