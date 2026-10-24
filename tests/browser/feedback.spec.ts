import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { git, repoWithRemote, type TestRepo } from '../../apps/server/test/ship-support.ts';
import { resetTestDatabase } from './database.ts';
import { turnDone } from './project-chat-kit.ts';
import { buildNotes, chatIn } from './result-block-kit.ts';
import { FAKE_GH_STATE, STUB_PORT } from './stub-config.ts';

test.describe.configure({ timeout: 120_000 });
let base = '';

test.beforeEach(async ({ page, request }) => {
  base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-feedback-')));
  await resetTestDatabase({ onboarded: true, connected: ['claude', 'codex'] });
  await request.post(`http://127.0.0.1:${STUB_PORT}/github-test/reset`);
  await page.setViewportSize({ width: 1400, height: 1200 });
});

test.afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(FAKE_GH_STATE, { force: true });
});

const turns = (page: Page) => page.locator('section[data-turn]');
const feedbackIn = (page: Page, turn: number) =>
  turns(page).nth(turn).locator('.turn-meta').getByRole('group', { name: 'How did it go?' });

async function sendAndWait(page: Page, text: string, count: number): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  await expect(page.locator('.turn-meta')).toHaveCount(count, { timeout: 60_000 });
  await turnDone(page, 60_000);
}

function pushedCommits(repo: TestRepo): number {
  const branch = git(repo.bare, 'for-each-ref', '--format=%(refname)', 'refs/heads/spark/');
  return Number(git(repo.bare, 'rev-list', '--count', branch));
}

async function chatWithPullRequest(page: Page): Promise<TestRepo> {
  const repo = await repoWithRemote(base, 'feedback');
  writeFileSync(FAKE_GH_STATE, 'octo-cli');
  await chatIn(page, repo, 'Full auto');
  await sendAndWait(page, 'What does the notes file hold?', 1);
  await buildNotes(page);
  await expect(page.locator('.pr-opened')).toHaveCount(1, { timeout: 30_000 });
  return repo;
}

test('asks how it went once, on the turn that opened the pull request', async ({ page }) => {
  const repo = await chatWithPullRequest(page);
  await expect(turns(page)).toHaveCount(2);
  await expect(turns(page).nth(1).locator('.pr-opened')).toHaveCount(1);
  await expect(feedbackIn(page, 0)).toHaveCount(0);
  const feedback = feedbackIn(page, 1);
  await expect(feedback).toBeVisible({ timeout: 15_000 });
  await expect(feedback).not.toHaveClass(/quiet/);
  await expect(feedback.locator('.fb-q')).toHaveCount(0);

  const good = feedback.getByRole('button', { name: 'Good result' });
  await good.focus();
  await page.keyboard.press('Enter');
  await expect(good).toHaveAttribute('aria-pressed', 'true');
  await expect(feedback.getByRole('status')).toHaveText('Saved');

  const before = pushedCommits(repo);
  await sendAndWait(page, 'Add another line to the notes #edit #plan', 3);
  await expect.poll(() => pushedCommits(repo), { timeout: 30_000 }).toBeGreaterThan(before);
  await expect(page.locator('.pr-opened')).toHaveCount(1);
  await expect(feedbackIn(page, 2)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'How did it go?' })).toHaveCount(1);

  await page.reload();
  const again = feedbackIn(page, 1);
  await expect(again.getByRole('button', { name: 'Good result' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await again.getByRole('button', { name: 'Bad result' }).click();
  await again.getByRole('button', { name: 'Broke something' }).click();
  await expect(again.getByRole('button', { name: 'Broke something' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(again.getByRole('button', { name: 'Good result' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('group', { name: 'How did it go?' })).toHaveCount(1);
});

test('Cancel and Esc close the feedback comment without saving it', async ({ page }) => {
  await chatWithPullRequest(page);
  const feedback = feedbackIn(page, 1);
  const good = feedback.getByRole('button', { name: 'Good result' });
  await good.click();
  await expect(feedback.getByRole('status')).toHaveText('Saved');
  const note = feedback.getByRole('textbox', { name: 'Comment (optional)' });

  await feedback.getByRole('button', { name: 'Add a comment' }).click();
  await note.fill('Not saved');
  await feedback.getByRole('button', { name: 'Cancel' }).click();
  await expect(note).toBeHidden();
  await expect(good).toBeFocused();
  await expect(good).toHaveAttribute('aria-pressed', 'true');

  await feedback.getByRole('button', { name: 'Add a comment' }).click();
  await expect(note).toHaveValue('');
  await note.fill('Also not saved');
  await note.press('Escape');
  await expect(note).toBeHidden();
  await expect(good).toBeFocused();

  await page.reload();
  const again = feedbackIn(page, 1);
  await expect(again.getByRole('button', { name: 'Good result' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(again.getByRole('textbox', { name: 'Comment (optional)' })).toBeHidden();
});

test('a chat with no pull request never asks how it went', async ({ page }) => {
  const repo = await repoWithRemote(base, 'nopull');
  await chatIn(page, repo, 'Auto-edit');
  await sendAndWait(page, 'What does the notes file hold?', 1);
  await buildNotes(page);
  await expect(page.locator('.turn-meta')).toHaveCount(2);
  await expect(page.locator('.pr-opened')).toHaveCount(0);
  await expect(page.getByRole('group', { name: /How did it go\?|What went wrong\?/ })).toHaveCount(
    0,
  );
});
