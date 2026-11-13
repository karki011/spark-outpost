import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WORKFLOW_NOTE_HEADER, WORKFLOW_STEP_HEADER } from '../src/crew-flows/step-prompt.ts';
import { WORKFLOW_STOPPED } from '../src/crew-flows/workflow-turn.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { actionFacts } from '../src/spark-mcp/actions/action-policy.ts';
import type { Worker } from '../src/workflow/worker.ts';
import {
  newSpark,
  recordOf,
  saveFlow,
  statesOf,
  step,
  stepReply,
  useWorkflowsDir,
} from './crew-workflow-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';
import { gitRepo, openChat, removeRepo, repliesOf, sendMessage } from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';
import { randomUUID } from 'node:crypto';

let t: TestDb;
let root: string;
let harness: Worker | null = null;
let dropWorkflows: () => Promise<void>;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  dropWorkflows = await useWorkflowsDir();
  await connectAgents(t);
  harness = startTurnWorker(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  await dropWorkflows();
});

async function start(text: string) {
  const conversationId = await openChat(t, { root, level: 'hands-off' });
  const runId = await sendMessage(t, conversationId, text);
  return { conversationId, runId };
}

async function finished(runId: string) {
  await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null), 60_000);
  return recordOf(t, runId);
}

async function childCount(runId: string): Promise<number> {
  const { rows } = await t.db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM runs WHERE parent_run_id = $1',
    [runId],
  );
  return rows[0]!.count;
}

describe('a workflow started by @id in a chat', () => {
  it('runs steps without parents side by side, then the step that joins on all of them', async () => {
    const pip = await newSpark(t, 'Pip');
    const wren = await newSpark(t, 'Wren', { role: 'Docs writer' });
    await saveFlow(t, 'review-flow', [
      step('security', pip.id, { prompt: 'Look for injection.' }),
      step('docs', wren.id),
      step('summary', pip.id, { dependsOn: ['security', 'docs'] }),
    ]);

    const { runId, conversationId } = await start('@review-flow look at parseDate');
    const record = await finished(runId);

    expect(record).toMatchObject({
      workflowId: 'review-flow',
      source: 'mention',
      kind: 'run',
      status: 'succeeded',
      conversationId,
      runId,
      stoppedBy: null,
    });
    expect(statesOf(record)).toEqual({
      security: 'succeeded',
      docs: 'succeeded',
      summary: 'succeeded',
    });
    const [security, docs, summary] = record!.steps;
    expect(Date.parse(docs!.startedAt!)).toBeLessThan(Date.parse(security!.finishedAt!));
    expect(Date.parse(security!.startedAt!)).toBeLessThan(Date.parse(docs!.finishedAt!));
    expect(Date.parse(summary!.startedAt!)).toBeGreaterThanOrEqual(
      Math.max(Date.parse(security!.finishedAt!), Date.parse(docs!.finishedAt!)),
    );

    const first = await stepReply(t, record, 'security');
    expect(first).toContain(WORKFLOW_STEP_HEADER);
    expect(first).toContain('Look for injection.');
    expect(first).toContain('look at parseDate');
    expect(first).not.toContain('@review-flow');
    const last = await stepReply(t, record, 'summary');
    expect(last).toContain('Step security (Pip · Code reviewer) replied:');
    expect(last).toContain('Step docs (Wren · Docs writer) replied:');

    const { rows } = await t.db.query<{ mode: string; role: string; step: string }>(
      `SELECT mode, role, route->'spark'->>'step' AS step FROM runs
       WHERE parent_run_id = $1 ORDER BY step_index`,
      [runId],
    );
    expect(rows).toEqual([
      { mode: 'ask', role: 'spark', step: 'security' },
      { mode: 'ask', role: 'spark', step: 'docs' },
      { mode: 'ask', role: 'spark', step: 'summary' },
    ]);
    expect((await getRun(t.db, runId))?.status).toBe('succeeded');
    const [note, ...more] = await repliesOf(t, runId);
    expect(more).toEqual([]);
    expect(note).toContain(WORKFLOW_NOTE_HEADER);
    expect(note).toContain('summary (Pip · Code reviewer) replied:');
    expect(note).toContain('The main agent did not run for this message.');
    expect((await loadOrchestration(t.db, runId))?.crew).toHaveLength(3);
  }, 90_000);

  it('gives the main agent every note when the message hands back to it', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'check', [step('look', pip.id)]);

    const { runId } = await start('@check parseDate, then summarise what it found');
    const record = await finished(runId);

    expect(record?.status).toBe('succeeded');
    const [reply] = await repliesOf(t, runId);
    const prompt = reply!.slice(reply!.indexOf('prompt='));
    expect(prompt).toContain(WORKFLOW_NOTE_HEADER);
    expect(prompt).toContain('look (Pip · Code reviewer) replied:');
    expect(prompt).toContain('do not redo the steps');
  }, 90_000);

  it('starts a step that joins on any parent as soon as one finishes, and stops with the turn', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'fan-out', [
      step('slow', pip.id, { prompt: 'Take your time. #slow' }),
      step('quick', pip.id),
      step('either', pip.id, { dependsOn: ['slow', 'quick'], join: 'any' }),
      step('both', pip.id, { dependsOn: ['slow', 'quick'] }),
    ]);

    const { runId } = await start('@fan-out go');
    await eventually(async () => {
      const states = statesOf(await recordOf(t, runId));
      return states.either === 'succeeded' && states.slow === 'running' ? true : null;
    }, 60_000);
    const during = await recordOf(t, runId);
    expect(statesOf(during)).toEqual({
      slow: 'running',
      quick: 'succeeded',
      either: 'succeeded',
      both: 'waiting',
    });
    expect(await stepReply(t, during, 'either')).toContain('Step quick (');

    await requestCancel(t.db, runId);
    const record = await finished(runId);

    expect(record?.status).toBe('cancelled');
    expect(statesOf(record)).toEqual({
      slow: 'cancelled',
      quick: 'succeeded',
      either: 'succeeded',
      both: 'skipped',
    });
    const slow = record!.steps.find((entry) => entry.stepId === 'slow')!;
    expect((await getRun(t.db, slow.runId!))?.status).toBe('cancelled');
    expect((await getRun(t.db, runId))?.status).toBe('cancelled');
    expect(await childCount(runId)).toBe(3);
  }, 90_000);

  it('keeps going after a failed step set to continue and passes its note on', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'tolerant', [
      step('flaky', pip.id, { prompt: '#crash', onFailure: 'continue' }),
      step('after', pip.id, { dependsOn: ['flaky'] }),
    ]);

    const { runId } = await start('@tolerant go');
    const record = await finished(runId);

    expect(statesOf(record)).toEqual({ flaky: 'failed', after: 'succeeded' });
    expect(record?.status).toBe('succeeded');
    expect(await stepReply(t, record, 'after')).toContain(
      'Step flaky (Pip · Code reviewer) could not finish',
    );
    expect((await getRun(t.db, runId))?.status).toBe('succeeded');
  }, 90_000);

  it('stops at a failed step set to stop and skips what depends on it', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'strict', [
      step('gate', pip.id, { prompt: '#crash' }),
      step('after', pip.id, { dependsOn: ['gate'] }),
      step('last', pip.id, { dependsOn: ['after'], join: 'any' }),
    ]);

    const { runId } = await start('@strict go');
    const record = await finished(runId);

    expect(statesOf(record)).toEqual({ gate: 'failed', after: 'skipped', last: 'skipped' });
    expect(record).toMatchObject({ status: 'failed', stoppedBy: 'gate' });
    expect(await childCount(runId)).toBe(1);
    expect(await getRun(t.db, runId)).toMatchObject({ status: 'failed', error: WORKFLOW_STOPPED });
    const [note] = await repliesOf(t, runId);
    expect(note).toContain('It stopped because step gate failed.');
    expect(note).toContain('after (Pip · Code reviewer) was skipped.');
  }, 90_000);

  it('does not start a workflow whose Spark was deleted after it was saved', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'orphan', [step('only', pip.id)]);
    await t.db.query('DELETE FROM teammates WHERE id = $1', [pip.id]);

    const { runId } = await start('@orphan go');
    await eventually(async () => ((await getRun(t.db, runId))?.finishedAt ? true : null), 60_000);

    expect(await recordOf(t, runId)).toBeNull();
    expect(await childCount(runId)).toBe(0);
  }, 90_000);
});

describe('what may start a workflow and what a step may claim', () => {
  it('leaves @id as plain text when the user did not type the message', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'check', [step('look', pip.id)]);
    const conversationId = await openChat(t, { root, level: 'hands-off' });

    const sent = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: '@check everything', source: 'assistant' },
      { provider: 'claude', model: 'sonnet', permission: 'ask', level: 'hands-off' },
    );
    await eventually(
      async () => ((await getRun(t.db, sent.run.id))?.finishedAt ? true : null),
      60_000,
    );

    expect(await recordOf(t, sent.run.id)).toBeNull();
    expect(await childCount(sent.run.id)).toBe(0);
  }, 90_000);

  it('never treats the message as asking for a Spark action inside a step', async () => {
    const pip = await newSpark(t, 'Pip');
    await saveFlow(t, 'check', [step('look', pip.id)]);

    const { runId } = await start('@check then update the ticket ABC-1 summary');
    const record = await finished(runId);

    const child = record!.steps[0]!.runId!;
    expect((await actionFacts(t.db, child, 'jira_edit')).requested).toBe(false);
    expect((await actionFacts(t.db, runId, 'jira_edit')).requested).toBe(true);
  }, 90_000);
});
