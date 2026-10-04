import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_HANDOFF_NOTE_MAX } from '@spark-outpost/contracts';
import { TEAMMATE_BRIEF_HEADER } from '../src/agents/acp/spark-instructions.ts';
import { SPARK_HANDOFF_HEADER, SPARK_JOB_HEADER } from '../src/orchestration/spark-job.ts';
import { addToQueue } from '../src/persistence/chat-queue.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { insertChildRun, loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { replyText } from '../src/persistence/spark-mentions.ts';
import { createTeammate, deleteTeammate } from '../src/persistence/teammates.ts';
import { chatTarget, drainQueue } from '../src/workflow/queue-drain.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { SPARK_HANDOFF_METHOD } from '../src/workflow/spark-audit.ts';
import {
  assistantReplies,
  connectProviders,
  gitRepo,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, eventually, startChat, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

const INSTRUCTIONS = 'Always name the file and line you mean.';

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t, false);
  harness = startOrchestrator(t, null);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

function spark(name: string, extra: Record<string, unknown> = {}) {
  return createTeammate(t.db, t.workspaceId, {
    name,
    role: 'Code reviewer',
    provider: null,
    model: null,
    agentMode: null,
    level: null,
    instructions: INSTRUCTIONS,
    projectIds: [],
    ...extra,
  });
}

const ask = (text: string): Scenario => ({ id: 'spark', text, mode: 'ask' });
const change = (text: string): Scenario => ({ id: 'spark', text, mode: 'do' });

interface ChildRow {
  id: string;
  role: string;
  mode: string;
  provider: string;
  model: string | null;
  status: string;
  agent_mode: string | null;
  agent_label: string;
  cost_usd: string | null;
  route: { name: string; spark: { id: string; role: string; only: boolean } };
}

async function children(runId: string): Promise<ChildRow[]> {
  const { rows } = await t.db.query<ChildRow>(
    `SELECT id, role, mode, provider, model, status, agent_mode, agent_label, cost_usd, route
     FROM runs WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function run(
  scenario: Scenario,
  agentMode?: string,
  prepare?: (id: string) => Promise<void>,
) {
  const started = await startScenario(
    t,
    root,
    scenario,
    scenario.mode === 'do' ? 'hands-off' : null,
    'pinned',
    'sonnet',
    agentMode,
    prepare,
  );
  await eventually(
    async () => ((await getRun(t.db, started.runId))?.finishedAt ? true : null),
    60_000,
  );
  return started;
}

function systemAppend(reply: string): string {
  const json = reply.slice(reply.indexOf('session=') + 'session='.length).split('\n')[0]!;
  const report = JSON.parse(json) as { meta: { systemPrompt?: { append?: string } } | null };
  return report.meta?.systemPrompt?.append ?? '';
}

describe('a message that mentions a Spark', () => {
  it('runs the Spark as a read-only child run and never runs the main agent', async () => {
    const pip = await spark('Pip');

    const { conversationId, runId } = await run(ask('@Pip review parseDate'));

    const [child, ...others] = await children(runId);
    expect(others).toEqual([]);
    expect(child).toMatchObject({
      role: 'spark',
      mode: 'ask',
      provider: 'claude',
      model: 'sonnet',
      status: 'succeeded',
      agent_label: 'Pip · Code reviewer',
      route: { name: 'Pip', spark: { id: pip.id, role: 'Code reviewer', only: true } },
    });
    const reply = await replyText(t.db, child!.id);
    expect(reply).toContain(SPARK_JOB_HEADER);
    expect(reply).toContain('@Pip review parseDate');
    expect(reply).toMatch(/mode=(plan|read-only) /);

    const top = await getRun(t.db, runId);
    expect(top?.status).toBe('succeeded');
    const [note, ...more] = await assistantReplies(t, runId);
    expect(more).toEqual([]);
    expect(note).toContain(SPARK_HANDOFF_HEADER);
    expect(note).toContain('Pip · Code reviewer replied:');
    expect(note).toContain('The main agent did not run for this message.');
    const sessions = await t.db.query(
      'SELECT 1 FROM provider_sessions WHERE conversation_id = $1',
      [conversationId],
    );
    expect(sessions.rowCount).toBe(0);
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
  }, 60_000);

  it('gives the Spark its standing instructions in its own session, not the chat history', async () => {
    await spark('Pip');
    const first = await run(ask('Remember the word marigold.'));
    const sent = await startFollowUp(first.conversationId, '@Pip what is in notes.txt? #session');

    const [child] = await children(sent);
    const append = systemAppend(await replyText(t.db, child!.id));
    expect(append).toContain(`${TEAMMATE_BRIEF_HEADER} for the Spark teammate Pip (Code reviewer)`);
    expect(append).toContain(INSTRUCTIONS);

    const plain = await startFollowUp(first.conversationId, '@Pip what is in notes.txt?');
    const [second] = await children(plain);
    const prompt = await replyText(t.db, second!.id);
    expect(prompt).not.toContain('This is a continuing conversation');
    expect(prompt).not.toContain('User: Remember the word marigold.');
    expect(prompt).toContain("The main agent's last reply, shortened:");
  }, 120_000);

  it('hands a short note back when the message continues with the main agent', async () => {
    await spark('Pip');
    const padding = 'context '.repeat(600);

    const { runId } = await run(ask(`@Pip review parseDate ${padding}, then summarise it`));

    const [child] = await children(runId);
    expect(child?.route.spark.only).toBe(false);
    const transcript = await replyText(t.db, child!.id);
    expect(transcript.length).toBeGreaterThan(SPARK_HANDOFF_NOTE_MAX * 2);
    const [reply] = await assistantReplies(t, runId);
    const mainPrompt = reply!.slice(reply!.indexOf('prompt='));
    const note = mainPrompt.slice(mainPrompt.indexOf(SPARK_HANDOFF_HEADER));
    expect(note).toContain('Pip · Code reviewer replied:');
    expect(note).toContain('do not redo the part handed to Pip');
    expect(note).toContain('spark_chat');
    expect(note.length).toBeLessThan(SPARK_HANDOFF_NOTE_MAX + 800);
    expect(mainPrompt).not.toContain(INSTRUCTIONS);
    expect(mainPrompt).not.toContain(transcript);
    const top = await getRun(t.db, runId);
    expect(top?.status).toBe('succeeded');
  }, 60_000);

  it('never widens the chat: a Bypass chat and a Full auto Spark still get a read-only subagent', async () => {
    await spark('Bolt', { provider: 'claude', agentMode: 'bypassPermissions', level: 'full-auto' });

    const { conversationId, runId } = await run(
      change('@Bolt fix the typo in notes.txt #write'),
      'bypassPermissions',
    );

    const [child] = await children(runId);
    expect(child).toMatchObject({ role: 'spark', mode: 'ask' });
    expect(await replyText(t.db, child!.id)).not.toContain('mode=bypassPermissions');
    const top = await getRun(t.db, runId);
    expect(top).toMatchObject({ mode: 'do', level: 'hands-off' });
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.conversation.teammate ?? null).toBeNull();
    expect(detail?.approvals).toEqual([]);
    const changed = await t.db.query('SELECT 1 FROM run_changes LIMIT 1').catch(() => null);
    expect(changed?.rowCount ?? 0).toBe(0);
  }, 60_000);

  it('uses the Spark’s own connected provider and model', async () => {
    await spark('Wren', { provider: 'codex', model: 'gpt-6-luna' });

    const { runId } = await run(ask('@Wren draft the release notes'));

    const [child] = await children(runId);
    expect(child).toMatchObject({ provider: 'codex', model: 'gpt-6-luna', status: 'succeeded' });
  }, 60_000);

  it('runs each mentioned Spark as its own subagent, in order', async () => {
    await spark('Pip');
    await spark('Wren', { role: 'Docs writer' });

    const { runId } = await run(ask('@Pip and @Wren look at notes.txt'));

    const crew = await children(runId);
    expect(crew.map((child) => child.agent_label)).toEqual([
      'Pip · Code reviewer',
      'Wren · Docs writer',
    ]);
    const [note] = await assistantReplies(t, runId);
    expect(note).toContain('Pip · Code reviewer replied:');
    expect(note).toContain('Wren · Docs writer replied:');
  }, 60_000);

  it('leaves an unknown name, and the chat’s own Spark, as plain text', async () => {
    const pip = await spark('Pip');

    const unknown = await run(ask('@Nobody review parseDate'));
    expect(await children(unknown.runId)).toEqual([]);
    expect((await assistantReplies(t, unknown.runId))[0]).toContain('@Nobody review parseDate');

    const own = await run(ask('@Pip review parseDate'), undefined, async (id) => {
      await t.db.query('UPDATE conversations SET teammate_id = $2 WHERE id = $1', [id, pip.id]);
    });
    expect(await children(own.runId)).toEqual([]);
  }, 120_000);

  it('counts the Spark’s cost in the turn and keeps the label after the Spark is deleted', async () => {
    const pip = await spark('Pip');
    const { conversationId, runId } = await run(ask('@Pip review parseDate'));

    const [child] = await children(runId);
    const before = await loadOrchestration(t.db, runId);
    expect(before?.totals.byRole).toEqual([
      expect.objectContaining({ role: 'spark', runs: 1, tokens: 180 }),
    ]);
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.usageTotals.totalTokens).toBe(180);
    expect(detail?.runs.map((entry) => entry.id)).toEqual([runId]);
    expect(child?.status).toBe('succeeded');

    await deleteTeammate(t.db, t.workspaceId, pip.id);

    const after = await loadOrchestration(t.db, runId);
    expect(after?.crew).toEqual([
      expect.objectContaining({ name: 'Pip', role: 'spark', spark: expect.objectContaining({}) }),
    ]);
  }, 60_000);

  it('records the hand-off in the subagent’s audit log', async () => {
    await spark('Pip');
    const { runId } = await run(ask('@Pip review parseDate'));

    const [child] = await children(runId);
    const { rows } = await t.db.query<{ payload: { params: Record<string, unknown> } }>(
      'SELECT payload FROM run_protocol_log WHERE run_id = $1 AND method = $2',
      [child!.id, SPARK_HANDOFF_METHOD],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.params).toMatchObject({
      spark: 'Pip',
      role: 'Code reviewer',
      standingInstructions: true,
      mode: 'ask',
    });
  }, 60_000);

  it('hands a queued message to the Spark when the queue sends it', async () => {
    await spark('Pip');
    const first = await run(ask('What does parseDate do?'));
    const queuedId = randomUUID();
    await addToQueue(t.db, first.conversationId, {
      id: queuedId,
      content: '@Pip review parseDate',
    });

    expect(await drainQueue(t.db, first.conversationId, chatTarget(t.db))).toBe('sent');

    const runId = await topRunFor(queuedId);
    const [child] = await children(runId);
    expect(child).toMatchObject({ role: 'spark', status: 'succeeded' });
  }, 60_000);

  it('stops the Spark when the turn is stopped', async () => {
    await spark('Pip');
    const started = await startScenario(
      t,
      root,
      ask('@Pip review parseDate #slow'),
      null,
      'pinned',
    );
    const child = await eventually(async () => {
      const [found] = await children(started.runId);
      return found?.status === 'running' ? found : null;
    }, 30_000);

    await requestCancel(t.db, started.runId);

    await eventually(
      async () => ((await getRun(t.db, started.runId))?.finishedAt ? true : null),
      30_000,
    );
    expect((await getRun(t.db, started.runId))?.status).toBe('cancelled');
    expect((await getRun(t.db, child.id))?.status).toBe('cancelled');
    expect(await assistantReplies(t, started.runId)).toEqual([]);
  }, 60_000);
});

describe('restart recovery', () => {
  it('marks a Spark subagent whose worker died as outcome unknown', async () => {
    await harness?.stop();
    harness = null;
    const pip = await spark('Pip');
    const { runId } = await startChat(t, '@Pip review parseDate');
    const lease = await insertChildRun(
      t.db,
      {
        parentRunId: runId,
        role: 'spark',
        stepIndex: 0,
        attempt: 1,
        agentLabel: 'Pip · Code reviewer',
        provider: 'fake',
        model: null,
        effort: null,
        mode: 'chat',
        prompt: 'review',
        route: { name: 'Pip', spark: { id: pip.id, role: 'Code reviewer', only: true } },
      },
      30,
    );
    await t.db.query(
      `UPDATE jobs SET lease_expires_at = now() - interval '1 minute' WHERE run_id = $1`,
      [lease.runId],
    );

    expect(await recoverExpiredLeases(t.db)).toBe(1);

    expect((await getRun(t.db, lease.runId))?.status).toBe('outcome_unknown');
  });
});

async function topRunFor(messageId: string): Promise<string> {
  const runId = await eventually(async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM runs WHERE user_message_id = $1 AND parent_run_id IS NULL
         AND finished_at IS NOT NULL`,
      [messageId],
    );
    return rows[0]?.id ?? null;
  }, 60_000);
  return runId;
}

async function startFollowUp(conversationId: string, content: string): Promise<string> {
  const id = randomUUID();
  await addToQueue(t.db, conversationId, { id, content });
  await drainQueue(t.db, conversationId, chatTarget(t.db));
  return topRunFor(id);
}
