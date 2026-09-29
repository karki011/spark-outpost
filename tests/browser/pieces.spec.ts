import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { PIECE_CHECK_SCRIPT } from '../../apps/server/test/fake-acp-coordinator.ts';
import { agentHead, crewChat, crewRepo, resetCrew, send, type CrewRepo } from './crew-engine.ts';

let repo: CrewRepo;

test.beforeEach(async ({ page }) => {
  await resetCrew();
  repo = crewRepo();
  writeFileSync(path.join(repo.root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
  await page.setViewportSize({ width: 1400, height: 900 });
});

test.afterEach(() => repo.remove());

test('a story split into pieces shows the coordinator and a read-only piece board', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await crewChat(page, repo, 'Full auto');
  await send(page, 'Split this up into pieces: a store, an API and a view. #build #pieces');

  const board = page.getByRole('region', { name: 'Pieces' });
  await expect(board).toBeVisible({ timeout: 30_000 });
  const rows = board.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(board).toContainText('3 pieces, in order · 3 landed', { timeout: 60_000 });
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
  expect(repo.file('view.ts')).toContain('built by P3');
});
