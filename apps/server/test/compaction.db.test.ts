import { afterEach, describe, expect, it } from 'vitest';
import { HANDOFF_HEADINGS, HISTORY_TOOL_NOTE } from '../src/orchestration/handoff.ts';
import { AGENT_COMPACTED_NOTE } from '../src/compaction/before-turn.ts';
import { insertApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import {
  compactionsOf,
  newChat,
  pendingCard,
  percentOf,
  promptsOf,
  say,
  send,
  finished,
  sessionsOf,
  startCompactionHarness,
  type CompactionHarness,
} from './compaction-support.ts';
import { FAKE_ACP_COMPACT_REPLY, SELF_COMPACT_TRIGGER } from './fake-acp-context.ts';

let h: CompactionHarness;

afterEach(async () => {
  await h.stop();
});

describe('compaction at Automatic', { timeout: 60_000 }, () => {
  it('sends /compact in the session before the next message', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'hands-off');
    await say(h, id, 'Remember PELICAN');
    const quiet = await say(h, id, 'Keep going #ctx70');
    expect(quiet.steps.some((step) => step.includes('/compact'))).toBe(false);
    await say(h, id, 'More detail #ctx90');

    const next = await say(h, id, 'What was the word?');

    expect(next.run.status).toBe('succeeded');
    expect(next.steps).toContain('Sent /compact to the agent (180K tokens)');
    expect(next.steps).toContain(
      'Compacted the chat: 180K tokens → a ~16K summary; the size with the system prompt and tools shows after the next reply',
    );
    const sessions = await sessionsOf(h, id);
    expect(sessions).toHaveLength(1);
    const prompts = promptsOf(h, sessions[0]!.session_id);
    expect(prompts.at(-2)).toBe('/compact');
    expect(prompts.at(-1)?.startsWith(`${AGENT_COMPACTED_NOTE}\n\nWhat was the word?`)).toBe(true);
    expect(await compactionsOf(h, id)).toEqual([
      expect.objectContaining({
        method: 'agent',
        run_id: next.run.id,
        tokens_before: percentOf(90),
        tokens_after: sessions[0]!.context_used,
        summary: FAKE_ACP_COMPACT_REPLY,
      }),
    ]);
    expect(sessions[0]!.context_used).toBeGreaterThan(percentOf(8));
    const detail = await getConversationDetail(h.t.db, id);
    expect(detail?.compactions?.map((entry) => entry.method)).toEqual(['agent']);
  });

  it('writes a Spark summary and seeds a fresh session when the agent has no /compact', async () => {
    h = await startCompactionHarness([]);
    const id = await newChat(h, 'full-auto');
    await say(h, id, 'Remember PELICAN');
    await say(h, id, 'Plan the rollout #ctx92');

    const next = await say(h, id, 'Which word?');

    expect(next.run.status).toBe('succeeded');
    expect(next.steps).toContain('Compacted the chat with a Spark summary (184K tokens before)');
    expect(next.steps).toContain('Fresh session (compacted)');
    const sessions = await sessionsOf(h, id);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ close_reason: 'compacted' });
    expect(sessions[1]).toMatchObject({ close_reason: null });
    const [seeded] = promptsOf(h, sessions[1]!.session_id);
    expect(seeded).toContain(HANDOFF_HEADINGS.chat);
    expect(seeded).toContain(HISTORY_TOOL_NOTE);
    expect(seeded).toContain('Remember PELICAN');
    expect(seeded).toContain('Which word?');
    const [compaction] = await compactionsOf(h, id);
    expect(compaction).toMatchObject({
      method: 'spark',
      tokens_before: percentOf(92),
      tokens_after: percentOf(5),
    });
    expect(compaction?.summary).toContain('Plan the rollout');

    const later = await say(h, id, 'And now?');
    expect(later.steps).toContain('Continued session');
    expect(promptsOf(h, sessions[1]!.session_id).at(-1)?.startsWith('And now?')).toBe(true);
  });
});

describe('compaction safety', { timeout: 60_000 }, () => {
  it('records an agent that compacted its own context', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'hands-off');
    await say(h, id, 'Start #ctx60');
    const next = await say(h, id, `Carry on ${SELF_COMPACT_TRIGGER}`);
    expect(next.run.status).toBe('succeeded');
    expect(await compactionsOf(h, id)).toEqual([
      expect.objectContaining({
        method: 'agent-auto',
        run_id: next.run.id,
        tokens_before: percentOf(60),
        tokens_after: percentOf(10),
      }),
    ]);
  });

  it('does not compact while another card is pending in the chat', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'hands-off');
    const first = await say(h, id, 'Start #ctx90');
    await insertApproval(h.t.db, {
      runId: first.run.id,
      toolCallId: 'held',
      rpcId: null,
      kind: 'other',
      title: 'Waiting',
      payload: { command: null, cwd: null, paths: [], diffs: [], truncated: false },
      options: [],
      reason: null,
    });
    const next = await say(h, id, 'Next');
    expect(next.steps.some((step) => step.includes('ompact'))).toBe(false);
    expect(await compactionsOf(h, id)).toEqual([]);
  });

  it('asks at Review each step and runs nothing until the card is answered', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'balanced');
    await say(h, id, 'Start #ctx88');
    const runId = await send(h, id, 'Next');
    const card = await pendingCard(h, runId);
    expect(card.kind).toBe('compact');
    const sessions = await sessionsOf(h, id);
    expect(promptsOf(h, sessions[0]!.session_id)).toHaveLength(1);
    await requestCancel(h.t.db, runId);
    expect((await finished(h, runId)).status).toBe('cancelled');
    expect(await compactionsOf(h, id)).toEqual([]);
  });
});
