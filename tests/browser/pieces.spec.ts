import { expect, test } from '@playwright/test';
import { PIECE_CHECK_SCRIPT } from '../../apps/server/test/fake-acp-coordinator.ts';
import {
  agentHead,
  autoContinueAfter,
  crewChat,
  crewRepo,
  resetCrew,
  send,
  type CrewRepo,
} from './crew-engine.ts';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  repo.commit('piece-check.mjs', PIECE_CHECK_SCRIPT);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

test('a story split into pieces is planned first, then shows the coordinator and a read-only piece board', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await autoContinueAfter(page, 3);
  await crewChat(page, repo, 'Full auto');
  await send(page, 'Split this up: build a store, add an API and add a view. #build #pieces');

  await expect(page.getByRole('group', { name: /Build this plan\?/ })).toBeVisible({
    timeout: 30_000,
  });
  const board = page.getByRole('region', { name: 'Pieces' });
  await expect(board).toBeVisible({ timeout: 60_000 });
  const rows = board.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(board).toContainText('3 pieces, in order · 3 landed', { timeout: 60_000 });
  await expect(board.locator('.piece-board-why')).toContainText(
    /^Jev: 3 Builders \(0\.90\) · P1 [^·]+ · P2 [^·]+ · P3 [^·;]+; /,
  );
  const pieces: [string, string][] = [
    ['P1', 'Store'],
    ['P2', 'API'],
    ['P3', 'View'],
  ];
  for (const [key, title] of pieces) {
    await expect(rows.filter({ hasText: key })).toContainText(title);
    await expect(rows.filter({ hasText: key })).toContainText('landed');
  }
  await expect(board.getByRole('button')).toHaveCount(0);
  for (const name of ['Atlas', 'Bolt', 'Rivet', 'Tack']) {
    await expect(agentHead(page, name)).toBeVisible();
  }
  await expect(page.locator('.crew-turn .crew-foot')).toContainText('Done', { timeout: 30_000 });
  expect(repo.file('view.ts')).toContain('built by P3');
});
