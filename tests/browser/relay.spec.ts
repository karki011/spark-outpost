import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { seedRelay } from '../../apps/server/src/persistence/relay.ts';
import { openTestDb, resetTestDatabase } from './database.ts';
import { seedPrFollowUp } from './pr-follow-up-seed.ts';

const SHOTS = 'test-results/relay';

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, catalog: true });
});

async function withRelay(phase: 'fixing' | 'watching' = 'fixing') {
  const seeded = await seedPrFollowUp();
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    await seedRelay(db, workspaceId);
    const { rows } = await db.query<{ id: string }>(
      "SELECT id FROM runs WHERE conversation_id = $1 AND source = 'pr_follow_up'",
      [seeded.conversationId],
    );
    const outcome = {
      runId: rows[0]!.id,
      round: 1,
      ended: 'settled',
      pushed: true,
      merged: false,
      replied: 3,
      rerequested: true,
      needs: 0,
      unpushed: false,
    };
    await db.query(
      `UPDATE pr_watches SET phase = $2, approval_id = NULL, round_outcomes = $3::jsonb
       WHERE conversation_id = $1`,
      [seeded.conversationId, phase, JSON.stringify([outcome])],
    );
    await db.query('DELETE FROM approvals WHERE id = $1', [seeded.approvalId]);
    return seeded.conversationId;
  } finally {
    await db.end();
  }
}

async function setPhase(conversationId: string, phase: 'fixing' | 'watching') {
  const db = openTestDb();
  try {
    await db.query('UPDATE pr_watches SET phase = $2 WHERE conversation_id = $1', [
      conversationId,
      phase,
    ]);
  } finally {
    await db.end();
  }
}

const home = (page: Page) => page.locator('main.page', { has: page.locator('#home-greet') });
const sparks = (page: Page) => home(page).getByRole('region', { name: 'Your Sparks' });

async function openHome(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: /^Home/ })
    .click();
  await expect(home(page)).toBeVisible();
  const roster = home(page).locator('.hsparks');
  if ((await roster.getAttribute('open')) === null) await roster.locator('summary').click();
}

async function openCrew(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('dialog', { name: 'Profile & personality' })
    .getByRole('tab', { name: 'Crew' })
    .click();
  return page.getByRole('dialog', { name: 'Crew' });
}

test('Relay on Home lists the pull requests it watches and opens their chats', async ({ page }) => {
  const conversationId = await withRelay();
  await openHome(page);
  const card = sparks(page).getByRole('button', { name: /^Open Relay's chat/ });
  await expect(card).toContainText('Pull request follow-up');
  await expect(card).toContainText('Watching 1 pull request');
  const pulls = sparks(page).getByRole('list', { name: 'Pull requests Relay is watching' });
  const row = pulls.getByRole('button', {
    name: 'Open Fix the cents parser, pull request #7: Round running',
  });
  await expect(row).toContainText('#7');
  await expect(row).toContainText('Round running');
  await expect(sparks(page).getByRole('list', { name: 'Suggested Sparks' })).toBeVisible();
  await sparks(page).scrollIntoViewIfNeeded();
  await sparks(page).screenshot({ path: `${SHOTS}/home-card.png` });

  await setPhase(conversationId, 'watching');
  await page.reload();
  await expect(pulls.getByRole('button', { name: /pull request #7: Watching$/ })).toBeVisible();
  await pulls.getByRole('button', { name: /pull request #7/ }).click();
  await expect(
    page.locator('.head').getByRole('heading', { name: 'Fix the cents parser' }),
  ).toBeVisible();
  const turn = page.locator('[data-turn]').first();
  await expect(turn).toContainText('sent this follow-up round; you did not type it');
  await expect(turn).toContainText(
    'Relay replied to 3 comments, pushed a fix, re-requested review on #7.',
  );
  await turn.screenshot({ path: `${SHOTS}/round-attribution.png` });
});

test('Relay is renamed and restyled in Settings → Crew and keeps its job', async ({ page }) => {
  await withRelay('watching');
  await page.goto('/');
  const crew = await openCrew(page);
  const list = crew.getByRole('list', { name: 'Your Sparks' });
  await expect(list).toContainText('Relay');
  await expect(list).toContainText('Pull request follow-up');
  await list.getByRole('button', { name: 'Edit Relay' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit Relay' });
  await expect(sheet).toContainText('built-in pull request follow-up Spark');
  await expect(sheet.getByLabel('Standing instructions')).toHaveValue(/Never merge/);
  await sheet.getByLabel('Name').fill('Courier');
  await sheet.getByLabel('Standing instructions').fill('Reply in one short sentence.');
  await sheet.screenshot({ path: `${SHOTS}/crew-edit.png` });
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.ok(),
  );
  await sheet.getByRole('button', { name: 'Save' }).click();
  await saved;
  await expect(list).toContainText('Courier');

  const listed = (await (await page.request.get('/api/teammates')).json()) as {
    teammates: { name: string; kind?: string; instructions: string }[];
  };
  expect(listed.teammates).toEqual([
    expect.objectContaining({
      name: 'Courier',
      kind: 'pr_follow_up',
      instructions: 'Reply in one short sentence.',
    }),
  ]);

  await page.keyboard.press('Escape');
  await openHome(page);
  const pulls = sparks(page).getByRole('list', { name: 'Pull requests Courier is watching' });
  await expect(pulls.getByRole('button', { name: /pull request #7: Watching/ })).toBeVisible();
});
