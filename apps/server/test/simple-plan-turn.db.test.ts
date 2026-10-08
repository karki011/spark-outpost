import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { planDocuments } from '../src/persistence/plan-documents.ts';
import { expectConformantRun } from './agui-conformance.ts';
import { linkedConversation } from './approval-support.ts';
import { FAKE_PLAN } from './fake-acp-plans.ts';
import {
  connectProviders,
  driveToEnd,
  gitRepo,
  removeRepo,
  startOrchestrator,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, pinChatLevel, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t, false);
  harness = startOrchestrator(t, null);
  conversationId = (await linkedConversation(t, root)).conversationId;
  await pinChatLevel(t.db, conversationId, 'full-auto');
});

afterEach(async () => {
  await harness.stop();
  await t.cleanup();
  await removeRepo(root);
});

async function turn(content: string, permission: 'ask' | 'do', agentMode: string) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission,
      agentMode,
      level: 'full-auto',
    },
  );
  harness.worker.wake();
  const asked: { kind: string; title: string; plan: boolean }[] = [];
  const done = await driveToEnd(
    t,
    conversationId,
    sent.run.id,
    (approval) => {
      asked.push({
        kind: approval.kind,
        title: approval.title,
        plan: JSON.stringify(approval.payload).includes('Add CSV export'),
      });
      const allow = approval.options.find((option) => option.kind === 'allow_once');
      return allow ? { optionId: allow.optionId } : null;
    },
    60_000,
  ).catch(() => null);
  const run = await t.db.query<{ mode: string; status: string }>(
    'SELECT mode, status FROM runs WHERE id = $1',
    [sent.run.id],
  );
  const sentToAgent = await t.db.query<{
    method: string;
    payload: { params?: Record<string, unknown> };
  }>(
    `SELECT method, payload FROM run_protocol_log
     WHERE run_id = $1 AND direction = 'to_agent' AND kind = 'request' ORDER BY seq`,
    [sent.run.id],
  );
  const detail = await getConversationDetail(t.db, conversationId);
  return {
    runId: sent.run.id,
    lines: detail?.plans?.lines ?? [],
    asked,
    done,
    run: run.rows[0]!,
    requests: sentToAgent.rows,
    reply: detail?.messages.filter((message) => message.role === 'assistant').at(-1)?.content ?? '',
  };
}

function planModeSetBeforePrompt(requests: Awaited<ReturnType<typeof turn>>['requests']) {
  const set = requests.findIndex(
    (request) =>
      request.method === 'session/set_config_option' && request.payload.params?.value === 'plan',
  );
  const prompt = requests.findIndex((request) => request.method === 'session/prompt');
  return set >= 0 && set < prompt;
}

describe('a plan turn', { timeout: 120_000 }, () => {
  it('/plan starts the agent in its plan mode, the agent asks to leave it, and the same turn builds', async () => {
    const { asked, run, requests, reply, runId, lines } = await turn(
      '/plan Add CSV export #nativeplan',
      'do',
      'auto',
    );

    expect(run).toEqual({ mode: 'do', status: 'succeeded' });
    expect(planModeSetBeforePrompt(requests)).toBe(true);
    expect(asked).toEqual([{ kind: 'other', title: 'Approve Plan', plan: true }]);
    expect(reply).toContain('Plan approved with exit-plan-default. Building it now.');
    const prompt = requests.find((request) => request.method === 'session/prompt')!;
    expect(JSON.stringify(prompt.payload)).not.toContain('/plan');
    expect(await planDocuments(t.db, conversationId)).toEqual([
      expect.objectContaining({ source: 'claude_plan_mode', body: FAKE_PLAN, status: 'approved' }),
    ]);
    expect(lines).toEqual([{ runId, version: 1, items: 3, unit: 'steps' }]);
  });

  it('checks, keeps and commits what an approved plan built, like any other build', async () => {
    const { run, reply, done, runId } = await turn(
      '/plan Add CSV export #nativeplan #planbuilds',
      'do',
      'auto',
    );

    expect(run).toEqual({ mode: 'do', status: 'succeeded' });
    expect(reply).toContain('Building it now.');
    expect(reply).toMatch(/Committed [0-9a-f]{7} on spark\/\S+, not pushed\./);
    expect(done?.orchestration).toMatchObject({ status: 'succeeded' });
    const kept = await t.db.query<{ kind: string; decided_by: string }>(
      `SELECT kind, decided_by FROM approvals WHERE run_id = $1 AND kind = 'accept'`,
      [runId],
    );
    expect(kept.rows).toEqual([{ kind: 'accept', decided_by: 'level' }]);
    const turns = await t.db.query<{ role: string | null }>(
      `SELECT role FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL`,
      [conversationId],
    );
    expect(turns.rows).toHaveLength(1);
    await expectConformantRun(t.db, runId);
  });

  it('a question in a Plan-mode chat stays a read-only turn with an orchestration record', async () => {
    const { asked, run, done, lines, runId } = await turn('What does parseDate do?', 'ask', 'plan');

    expect(run).toEqual({ mode: 'ask', status: 'succeeded' });
    expect(asked).toEqual([]);
    expect(done?.orchestration).toMatchObject({ status: 'succeeded', risk: 'read-only' });
    const recorded = await t.db.query<{ purpose: string }>(
      `SELECT purpose FROM run_advice WHERE run_id = $1 AND purpose IN ('intake', 'route')`,
      [runId],
    );
    expect(recorded.rows.map((row) => row.purpose)).toEqual(
      expect.arrayContaining(['intake', 'route']),
    );
    expect(await planDocuments(t.db, conversationId)).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("a build request in a Plan-mode chat gets the same turn, with no card of Spark's own", async () => {
    const { asked, run, requests, reply } = await turn('Add CSV export #nativeplan', 'ask', 'plan');

    expect(run).toEqual({ mode: 'do', status: 'succeeded' });
    expect(planModeSetBeforePrompt(requests)).toBe(true);
    expect(asked.map((card) => card.title)).toEqual(['Approve Plan']);
    expect(reply).toContain('Building it now.');
    expect(reply).not.toContain('Kept planning');
  });
});
