import { expect, test, type Page } from '@playwright/test';
import { PIECE_CHECK_SCRIPT } from '../../apps/server/test/fake-acp-coordinator.ts';
import {
  CREW_REQUEST,
  agentHead,
  card,
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

const SPLIT = 'Split this up: build a store, add an API and add a view. #build #pieces';

async function buildInPieces(page: Page, tags: string) {
  await crewChat(page, repo, 'Full auto');
  await send(page, `${SPLIT} ${tags}`);
  const board = page.getByRole('region', { name: 'Pieces' });
  await expect(board).toContainText('3 pieces, in the shared tree · 3 landed', { timeout: 90_000 });
  await expect(page.locator('.crew-turn .crew-foot').first()).toContainText('Done', {
    timeout: 60_000,
  });
}

test('one Coordinator row for a list with an over-long goal, and a built plan stays out of the next turn', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await buildInPieces(page, '#longgoal');
  await expect(agentHead(page, 'Atlas')).toHaveCount(1);

  await send(page, 'cap 3 → 8 #build');
  const turns = page.locator('.crew-turn');
  await expect(turns).toHaveCount(2, { timeout: 60_000 });
  await expect(turns.nth(1).locator('.crew-foot')).toContainText('Done', { timeout: 90_000 });
  await expect(turns.nth(1).locator('.agent-name', { hasText: /^Atlas$/ })).toHaveCount(0);
  await expect(turns.nth(1).locator('.agent-name').first()).toBeVisible();
  await expect(agentHead(page, 'Atlas')).toHaveCount(1);
});

test('a piece Builder that plans first raises no plan card of its own', async ({ page }) => {
  test.setTimeout(240_000);
  await buildInPieces(page, '#pieceplans');
  await expect(card(page, /Approve Plan/)).toHaveCount(0);
  await expect(card(page, /Build this plan\?/)).toHaveCount(0);
  expect(repo.file('store.ts')).toContain('built by P1');
});

test('a Critic whose prompt fails hands the review to the other provider and says so', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await crewChat(page, repo, 'Full auto');
  await send(page, `${CREW_REQUEST} #build #crew #codexcriticdown`);
  const turn = page.locator('.crew-turn');
  await expect(turn).toContainText('reviewing instead of Codex, whose review did not finish', {
    timeout: 120_000,
  });
  await expect(turn).toContainText('Verdict: looks good', { timeout: 60_000 });
  await expect(turn.locator('.crew-foot')).toContainText('Done', { timeout: 60_000 });
  await expect(page.getByText(/Review skipped/)).toHaveCount(0);
});
