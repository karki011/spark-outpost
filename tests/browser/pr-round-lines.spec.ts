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

test('a follow-up round is one folded row that opens to what it did', async ({ page }) => {
  await seedSettledRound();
  await openChats(page);
  await expect(page.locator('.chat-title')).toHaveText('Fix the cents parser');
  const turn = page.locator('[data-turn]').first();
  await expect(turn.locator('.msg.me')).toHaveCount(0);
  const toggle = turn.getByRole('button', { name: /PR follow-up/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText(
    'PR #7 · round 1 · Replied to 3 comments, pushed a fix, re-requested review',
  );
  await expect(turn.getByText('Show what Spark sent')).toHaveCount(0);

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const sent = turn.locator('.auto-turn-sent');
  await expect(sent.locator('.bubble')).toBeHidden();
  await sent.getByText('Show what Spark sent').click();
  await expect(sent.locator('.bubble')).toContainText('PR follow-up, round 1: acme/widgets#7');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(turn.locator('.auto-turn-body')).toHaveCount(0);
});
