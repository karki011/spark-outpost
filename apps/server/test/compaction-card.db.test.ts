import { afterEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { movedReply } from '../src/compaction/prepare-turn.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { HANDOFF_HEADINGS } from '../src/orchestration/handoff.ts';
import {
  compactionsOf,
  finished,
  newChat,
  pendingCard,
  promptsOf,
  say,
  send,
  sessionsOf,
  startCompactionHarness,
  stepsOf,
  type CompactionHarness,
} from './compaction-support.ts';
import { eventually } from './support.ts';

let h: CompactionHarness;

afterEach(async () => {
  await h.stop();
});

async function answer(runId: string, optionId: string) {
  const card = await pendingCard(h, runId);
  expect(card.kind).toBe('compact');
  await decideApproval(h.t.db, h.t.workspaceId, card.id, { optionId, scope: 'once' });
  return finished(h, runId);
}

async function fullChat(): Promise<string> {
  await updateProfile(h.t.db, h.t.workspaceId, { autoCompact: false });
  const id = await newChat(h, 'hands-off');
  await say(h, id, 'Remember PELICAN');
  await say(h, id, 'Draft the plan #ctx88');
  return id;
}

describe('the compaction card with automatic compaction off', { timeout: 60_000 }, () => {
  it('offers three choices and compacts with the agent on Compact now', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await fullChat();
    const runId = await send(h, id, 'Next step');
    const card = await pendingCard(h, runId);
    expect((card.options as { name: string }[]).map((option) => option.name)).toEqual([
      'Compact now',
      'Start a fresh chat with a summary',
      'Keep going',
    ]);

    const run = await answer(runId, CHECKPOINT_OPTION.compactNow);

    expect(run.status).toBe('succeeded');
    expect(await stepsOf(h, runId)).toContain(
      'Compacted the chat: 176K tokens → a ~16K summary; the size with the system prompt and tools shows after the next reply',
    );
    expect((await compactionsOf(h, id)).map((row) => row.method)).toEqual(['agent']);
  });

  it('keeps going, then asks again only at 90% (the default 80% plus 10)', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await fullChat();
    const kept = await answer(await send(h, id, 'Next step'), CHECKPOINT_OPTION.keepGoing);
    expect(kept.status).toBe('succeeded');
    expect(await compactionsOf(h, id)).toEqual([]);
    expect((await sessionsOf(h, id))[0]).toMatchObject({ compact_snoozed: true });

    const quiet = await say(h, id, 'Keep at it #ctx92');
    expect(quiet.run.status).toBe('succeeded');

    const again = await send(h, id, 'Still there?');
    const run = await answer(again, CHECKPOINT_OPTION.compactNow);
    expect(run.status).toBe('succeeded');
    expect((await compactionsOf(h, id)).map((row) => row.method)).toEqual(['agent']);
    expect((await sessionsOf(h, id))[0]).toMatchObject({ compact_snoozed: false });
  });

  it('moves the message to a fresh chat seeded with a summary', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await fullChat();
    const runId = await send(h, id, 'Next step');

    const run = await answer(runId, CHECKPOINT_OPTION.freshChat);

    expect(run.status).toBe('succeeded');
    const old = await getConversationDetail(h.t.db, id);
    const [continued] = old?.continuedIn ?? [];
    expect(continued).toMatchObject({ runId, title: 'Remember PELICAN (continued)' });
    expect(old?.messages.at(-1)?.content).toBe(
      movedReply({ id: continued!.conversationId, title: continued!.title }),
    );
    expect((await sessionsOf(h, id)).map((row) => row.close_reason)).toEqual([
      'moved to a fresh chat',
    ]);

    const fresh = continued!.conversationId;
    const [seed] = await compactionsOf(h, fresh);
    expect(seed).toMatchObject({ method: 'spark', from_conversation_id: id });
    expect(seed?.summary).toContain('Draft the plan');
    const freshRun = await eventually(async () => {
      const detail = await getConversationDetail(h.t.db, fresh);
      const latest = detail?.runs.at(-1);
      return latest?.finishedAt ? latest : null;
    }, 20_000);
    expect(freshRun.status).toBe('succeeded');
    const [session] = await sessionsOf(h, fresh);
    const [first] = promptsOf(h, session!.session_id);
    expect(first).toContain(HANDOFF_HEADINGS.chat);
    expect(first).toContain('Next step');
    const detail = await getConversationDetail(h.t.db, fresh);
    expect(detail?.compactions?.[0]).toMatchObject({
      fromConversationId: id,
      fromTitle: 'Remember PELICAN',
      runId: freshRun.id,
    });
  });
});
