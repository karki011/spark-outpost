import { expect, test } from '@playwright/test';
import { openTestDb, resetTestDatabase } from './database.ts';
import { openChats } from './navigation.ts';
import { seedPrFollowUp } from './pr-follow-up-seed.ts';

test.beforeEach(async () => {
  await resetTestDatabase({ onboarded: true, catalog: true });
});

async function seedSettledRound() {
  const seeded = await seedPrFollowUp();
  const db = openTestDb();
  try {
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
      `UPDATE pr_watches SET phase = 'watching', approval_id = NULL, round_outcomes = $2::jsonb
       WHERE conversation_id = $1`,
      [seeded.conversationId, JSON.stringify([outcome])],
    );
    await db.query('DELETE FROM approvals WHERE id = $1', [seeded.approvalId]);
  } finally {
    await db.end();
  }
}

test('a follow-up round shows one line, hides what Spark sent and ends with what it did', async ({
  page,
}) => {
  await seedSettledRound();
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText('Fix the cents parser');
  const turn = page.locator('[data-turn]').first();
  await expect(turn).toContainText('Sent by Spark; you did not type it');
  await expect(turn.locator('.pr-round-head')).toContainText(
    'PR follow-up, round 1: acme/widgets#7',
  );
  const sent = turn.locator('.pr-round-sent');
  await expect(sent.locator('.bubble')).toBeHidden();
  await sent.getByText('Show what Spark sent').click();
  await expect(sent.locator('.bubble')).toBeVisible();
  await expect(turn).toContainText(
    'Follow-up replied to 3 comments, pushed a fix, re-requested review on #7.',
  );
});
