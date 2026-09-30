import { expect, test, type Locator, type Page } from '@playwright/test';
import { PIECE_CHECK_SCRIPT } from '../../apps/server/test/fake-acp-coordinator.ts';
import {
  autoContinueAfter,
  card,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
  type Level,
} from './crew-engine.ts';
import { openTestDb } from './database.ts';

const REQUEST = 'Split this up: build a store, add an API and add a view. #build #pieces #parallel';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  repo.commit('piece-check.mjs', PIECE_CHECK_SCRIPT);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

async function parallelChat(page: Page, level: Level, stableCheckout = false): Promise<void> {
  await crewChat(page, repo, level);
  const db = openTestDb();
  try {
    await db.query(
      'UPDATE projects SET parallel_pieces = true, stable_checkout = $2 WHERE root_path = $1',
      [repo.root, stableCheckout],
    );
  } finally {
    await db.end();
  }
}

async function buildThePlan(page: Page): Promise<void> {
  const plan = card(page, /Build this plan\?/);
  await expect(plan).toBeVisible({ timeout: 30_000 });
  await plan.getByRole('button', { name: 'Build this plan' }).click();
}

async function allowChecksUntil(page: Page, done: Locator, text: string): Promise<void> {
  await expect(async () => {
    const pending = card(page, /^Run a check\?/).filter({
      has: page.getByRole('button', { name: 'Deny' }),
    });
    if ((await pending.count()) > 0) {
      await pending.first().getByRole('button', { name: 'Allow', exact: true }).click();
    }
    await expect(done).toContainText(text, { timeout: 1_000 });
  }).toPass({ timeout: 90_000 });
}

const board = (page: Page) => page.getByRole('region', { name: 'Pieces' });
const parallelGroup = (page: Page) =>
  page.getByRole('group', { name: /^Work(ing|ed) in parallel: / });

test('Automatic builds independent pieces side by side in the shared tree', async ({ page }) => {
  test.setTimeout(150_000);
  await parallelChat(page, 'Auto-edit');
  await send(page, REQUEST);
  await buildThePlan(page);

  await allowChecksUntil(page, board(page), '3 pieces, in the shared tree · 3 landed');
  await expect(board(page).getByRole('button')).toHaveCount(0);
  const group = parallelGroup(page);
  await expect(group).toBeVisible();
  const heads = group.locator('.par-head');
  await expect(heads).toHaveCount(3);
  await expect(heads.filter({ hasText: 'Rivet' })).toContainText('P2 · shared tree · owns 3 files');
  const bolt = heads.filter({ hasText: 'Bolt' });
  await expect(bolt).toHaveAttribute('aria-expanded', 'false');
  await bolt.focus();
  await page.keyboard.press('Enter');
  await expect(bolt).toHaveAttribute('aria-expanded', 'true');
  await expect(group.locator('.par-body .agent-block')).toHaveCount(1);
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Agent TV' }).click();
  const tv = page.getByRole('dialog', { name: 'Agent TV' });
  await tv.getByRole('radio', { name: 'List' }).click();
  await tv.getByRole('button', { name: /^Finished/ }).click();
  await expect(tv.getByRole('listitem', { name: /^Bolt/ })).toContainText(
    'P1 · shared tree · owns 1 file',
  );
  expect(repo.file('api.ts')).toContain('built by P2');
});

test('Review each step asks for the split before building it, answered by keyboard', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await parallelChat(page, 'Review keep');
  await send(page, REQUEST);

  await buildThePlan(page);

  const split = card(page, /Build in 3 pieces, 2 at once in the shared tree\?/);
  await expect(split).toBeVisible({ timeout: 60_000 });
  await expect(board(page)).toContainText('waiting for your go-ahead');
  await expect(split.getByRole('button', { name: 'Build in order instead' })).toBeVisible();
  await expect(split.getByRole('button', { name: 'Revise' })).toBeVisible();
  const build = split.getByRole('button', { name: 'Build it' });
  await build.focus();
  await page.keyboard.press('Enter');
  await expect(split).toContainText('Build it');

  await allowChecksUntil(page, board(page), '3 pieces, in the shared tree · 3 landed');
  await expect(parallelGroup(page)).toBeVisible();
});

test('Full auto builds each piece in its own copy of the chat worktree', async ({ page }) => {
  test.setTimeout(150_000);
  await autoContinueAfter(page, 3);
  await parallelChat(page, 'Full auto', true);
  await send(page, REQUEST);

  await expect(board(page)).toContainText('3 pieces, in worktrees · 3 landed', {
    timeout: 90_000,
  });
  const group = parallelGroup(page);
  await expect(group.locator('.par-head').filter({ hasText: 'Tack' })).toContainText(
    "P3 · Tack's copy",
  );
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 60_000 });
  expect(repo.file('view.ts')).toContain('built by P3');
});
