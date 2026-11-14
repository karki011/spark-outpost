import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoundOutcome } from '@spark-outpost/contracts';
import { getWatch } from '../src/persistence/pr-watches.ts';
import { recordRoundOutcome } from '../src/persistence/round-outcomes.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

describe('round outcomes', () => {
  it('keeps one outcome per round run, so a repeated settle does not add a second', async () => {
    const watchId = randomUUID();
    const conversationId = randomUUID();
    await t.db.query('INSERT INTO conversations (id, workspace_id, title) VALUES ($1, $2, $3)', [
      conversationId,
      t.workspaceId,
      'Tidy the notes',
    ]);
    await t.db.query(
      `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url,
         branch, next_poll_at)
       VALUES ($1, $2, $3, 'github.com', 'acme', 'widgets', 7,
         'https://github.com/acme/widgets/pull/7', 'spark/tidy', now())`,
      [watchId, t.workspaceId, conversationId],
    );
    const outcome: RoundOutcome = {
      runId: randomUUID(),
      round: 1,
      ended: 'settled',
      pushed: true,
      merged: false,
      replied: 2,
      rerequested: false,
      needs: 0,
      unpushed: false,
    };
    const second = { ...outcome, runId: randomUUID(), round: 2, pushed: false };
    await recordRoundOutcome(t.db, watchId, outcome);
    await recordRoundOutcome(t.db, watchId, second);
    await recordRoundOutcome(t.db, watchId, { ...outcome, replied: 3 });
    const { rows } = await t.db.query<{ round_outcomes: RoundOutcome[] }>(
      'SELECT round_outcomes FROM pr_watches WHERE id = $1',
      [watchId],
    );
    expect(rows[0]!.round_outcomes.map((entry) => [entry.round, entry.replied])).toEqual([
      [2, 2],
      [1, 3],
    ]);
    expect(await getWatch(t.db, watchId)).toBeNull();
  });
});
