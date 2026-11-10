import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { needsYouCount } from '@spark-outpost/contracts';
import { closePost, listPosts } from '../src/persistence/outpost-posts.ts';
import { needsYouCounts } from '../src/persistence/outpost-needs-you.ts';
import { toOutpostPost } from '../src/outposts/post-view.ts';
import { pendingApproval } from './a2a-fixtures.ts';
import { addMemberChat, createOutpostRow, insertRequestRow } from './outpost-fixtures.ts';
import { carry, chatWithTurn, reply, setRun } from './outpost-store-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

type Ending = 'asks' | 'plain' | 'blank' | 'approval' | 'running' | 'failed' | 'closed';

async function request(outpostId: string, chat: string, ending: Ending): Promise<void> {
  const turn = await chatWithTurn(t);
  await t.db.query('UPDATE runs SET conversation_id = $2 WHERE id = $1', [turn.runId, chat]);
  const id = await insertRequestRow(t.db, { outpostId, toConversationId: chat, toHandle: 'api' });
  await carry(t, id, turn.runId);
  if (ending === 'asks') await reply(t, turn.runId, 'Found two.\n\nNeeds you: pick v1 or v2.');
  if (ending === 'blank') await reply(t, turn.runId, 'Needs you:');
  if (ending === 'plain') await reply(t, turn.runId, 'All done.');
  if (ending === 'approval') await pendingApproval(t.db, turn.runId);
  const status = {
    asks: 'succeeded',
    plain: 'succeeded',
    blank: 'succeeded',
    approval: 'awaiting_approval',
    running: 'running',
    failed: 'failed',
    closed: 'succeeded',
  } as const;
  await setRun(t, turn.runId, status[ending]);
  if (ending === 'closed') await closePost(t.db, id, { state: 'cancelled', reason: null });
}

async function counting(outpostId: string): Promise<number> {
  const posts = (await listPosts(t.db, outpostId)).map((post) => toOutpostPost(post, null));
  return needsYouCount(posts);
}

describe('the outpost list counts what needs you in one read', () => {
  it('matches the count the detail derives for every outpost', async () => {
    const first = await createOutpostRow(t, 'First');
    const second = await createOutpostRow(t, 'Second');
    const empty = await createOutpostRow(t, 'Empty');
    const chatA = await addMemberChat(t, first, 'api');
    const chatB = await addMemberChat(t, second, 'api');
    for (const ending of ['asks', 'asks', 'plain', 'blank', 'approval', 'running'] as const) {
      await request(first, chatA, ending);
    }
    for (const ending of ['approval', 'failed', 'closed', 'plain'] as const) {
      await request(second, chatB, ending);
    }

    const counts = await needsYouCounts(t.db, t.workspaceId);

    expect(await counting(first)).toBe(3);
    expect(counts.get(first) ?? 0).toBe(await counting(first));
    expect(counts.get(second) ?? 0).toBe(await counting(second));
    expect(counts.get(second)).toBe(1);
    expect(counts.get(empty) ?? 0).toBe(await counting(empty));
  });
});
