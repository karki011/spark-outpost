import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { updateProfile } from '../src/persistence/setup.ts';
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

let h: CompactionHarness;

afterEach(async () => {
  await h.stop();
});

const PLAN_LINE =
  'Context compacted at a natural break: the last turn finished its plan (65% full)';

async function finishPlan(runId: string, status = 'completed') {
  const todo = [
    { content: 'Write the parser', priority: 'high', status: 'completed' },
    { content: 'Test it', priority: 'medium', status },
  ];
  await h.t.db.query('UPDATE runs SET todo = $2 WHERE id = $1', [runId, JSON.stringify(todo)]);
}

async function openPullRequest(conversationId: string, runId: string) {
  const taskId = randomUUID();
  await h.t.db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
    taskId,
    conversationId,
    'Parser',
  ]);
  await h.t.db.query(
    `INSERT INTO task_links (id, task_id, kind, url, title, source, created_at)
     SELECT $1, $2, 'pr', 'https://github.com/acme/app/pull/7', 'acme/app#7', 'tool_output',
       r.created_at + interval '1 millisecond'
     FROM runs r WHERE r.id = $3`,
    [randomUUID(), taskId, runId],
  );
}

describe('compaction at a natural break', { timeout: 60_000 }, () => {
  it('compacts past the warning point after a turn that finished its plan', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'hands-off');
    const done = await say(h, id, 'Build the parser #ctx65');
    await finishPlan(done.run.id);

    const next = await say(h, id, 'Now the docs');

    expect(next.run.status).toBe('succeeded');
    expect(next.steps).toContain(PLAN_LINE);
    const [session] = await sessionsOf(h, id);
    expect(promptsOf(h, session!.session_id).at(-2)).toMatch(/^\/compact Write the summary/);
    expect((await compactionsOf(h, id)).map((row) => row.method)).toEqual(['agent']);
  });

  it('compacts after a turn that opened a pull request', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'hands-off');
    const done = await say(h, id, 'Open the PR #ctx70');
    await openPullRequest(id, done.run.id);

    const next = await say(h, id, 'Next task');

    expect(next.steps).toContain(
      'Context compacted at a natural break: the last turn opened or updated a pull request (70% full)',
    );
  });

  it('leaves the chat alone mid-plan, below the warning point, or with the setting off', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'hands-off');
    const midway = await say(h, id, 'Build the parser #ctx65');
    await finishPlan(midway.run.id, 'in_progress');
    const afterMidway = await say(h, id, 'Keep going');
    expect(afterMidway.steps.some((step) => step.includes('ompact'))).toBe(false);

    const cool = await say(h, id, 'Small fix #ctx50');
    await finishPlan(cool.run.id);
    const afterCool = await say(h, id, 'Another');
    expect(afterCool.steps.some((step) => step.includes('ompact'))).toBe(false);

    await updateProfile(h.t.db, h.t.workspaceId, { compactAtBreak: false });
    const warm = await say(h, id, 'Finish it #ctx65');
    await finishPlan(warm.run.id);
    const afterOff = await say(h, id, 'Then this');
    expect(afterOff.steps.some((step) => step.includes('ompact'))).toBe(false);
    expect(await compactionsOf(h, id)).toEqual([]);
  });

  it('reads only the turn just before, not an older finished plan', async () => {
    h = await startCompactionHarness(['compact']);
    const id = await newChat(h, 'hands-off');
    const older = await say(h, id, 'Plan done #ctx62');
    await finishPlan(older.run.id);
    await h.t.db.query(`UPDATE runs SET status = 'cancelled' WHERE id = $1`, [older.run.id]);
    const stopped = await say(h, id, 'Stopped turn #ctx64');
    expect(stopped.steps.some((step) => step.includes('ompact'))).toBe(false);
    const plain = await say(h, id, 'No plan here #ctx65');
    expect(plain.steps.some((step) => step.includes('ompact'))).toBe(false);
    expect(await compactionsOf(h, id)).toEqual([]);
  });

  it('asks with the card at a natural break when automatic compaction is off', async () => {
    h = await startCompactionHarness(['compact']);
    await updateProfile(h.t.db, h.t.workspaceId, { autoCompact: false });
    const id = await newChat(h, 'hands-off');
    const done = await say(h, id, 'Build the parser #ctx65');
    await finishPlan(done.run.id);

    const runId = await send(h, id, 'Now the docs');
    const card = await pendingCard(h, runId);
    const { rows } = await h.t.db.query<{ reason: string }>(
      'SELECT reason FROM approvals WHERE id = $1',
      [card.id],
    );
    expect(rows[0]?.reason).toContain(
      'The last turn finished its plan, a natural break to compact.',
    );
    await decideApproval(h.t.db, h.t.workspaceId, card.id, {
      optionId: CHECKPOINT_OPTION.keepGoing,
      scope: 'once',
    });
    expect((await finished(h, runId)).status).toBe('succeeded');
    expect(await stepsOf(h, runId)).not.toContain(PLAN_LINE);

    const again = await say(h, id, 'Plan finished again');
    await finishPlan(again.run.id);
    const later = await say(h, id, 'And more');
    expect(later.steps.some((step) => step.includes('ompact'))).toBe(false);
  });
});
