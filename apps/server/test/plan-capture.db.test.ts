import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Approval, InvolvementLevel, RunMode } from '@spark-outpost/contracts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { planDocuments } from '../src/persistence/plan-documents.ts';
import { getRun } from '../src/persistence/runs.ts';
import { linkedConversation } from './approval-support.ts';
import { FAKE_PLAN } from './fake-acp-plans.ts';
import {
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  type Answerer,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

function start(planAgreed: number | null) {
  const script: JevScript = {
    calls: [],
    scenario: {
      id: 'plan',
      text: '',
      mode: 'do',
      question: 0.02,
      destructive: 0.03,
      ...(planAgreed === null ? {} : { planAgreed }),
    },
  };
  harness = startOrchestrator(t, planAgreed === null ? null : jevFetch(script));
  return script;
}

async function say(
  conversationId: string,
  content: string,
  permission: RunMode = 'do',
  level: InvolvementLevel = 'balanced',
) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'claude', model: 'sonnet', effort: 'medium', permission, level },
  );
  return sent.run.id;
}

async function finished(runId: string) {
  return eventually(async () => (await getRun(t.db, runId))?.finishedAt, 30_000);
}

async function builderPrompts(conversationId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ prompt: string }>(
    `SELECT prompt FROM runs WHERE conversation_id = $1 AND role = 'builder' ORDER BY created_at`,
    [conversationId],
  );
  return rows.map((row) => row.prompt);
}

async function assistantReplies(conversationId: string) {
  const detail = await getConversationDetail(t.db, conversationId);
  return detail!.messages.filter((message) => message.role === 'assistant');
}

async function planAdvice(runId: string) {
  const { rows } = await t.db.query<{ jev_status: string; body: Record<string, unknown> }>(
    `SELECT jev_status, body FROM run_advice WHERE run_id = $1 AND purpose = 'plan_agreed'`,
    [runId],
  );
  return rows;
}

async function switchedToPlan(runId: string): Promise<boolean> {
  const { rows } = await t.db.query<{ payload: string }>(
    `SELECT payload::text FROM run_protocol_log
     WHERE run_id = $1 AND direction = 'to_agent'
       AND method IN ('session/set_config_option', 'session/set_mode')`,
    [runId],
  );
  return rows.some((row) => /"(?:value|modeId)":\s*"plan"/.test(row.payload));
}

const head = () => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD']).toString().trim();

const rejectPlans: Answerer = (approval: Approval) =>
  approval.payload.plan ? { optionId: 'reject' } : answerEverything(approval);

describe("Claude's plan mode", { timeout: 60_000 }, () => {
  beforeEach(() => connectProviders(t, false));

  it('saves the plan as proposed, shows it on the approval, and marks it approved with the commit', async () => {
    start(null);
    const { conversationId } = await linkedConversation(t, root);
    const runId = await say(conversationId, 'Add CSV export #planmode #build');
    const { asked } = await driveToEnd(t, conversationId, runId);
    const approval = asked.find((candidate) => candidate.payload.plan);
    expect(approval?.payload.plan).toBe(FAKE_PLAN);
    expect(approval?.options.map((option) => option.optionId)).toEqual([
      'exit-plan-clear-auto',
      'exit-plan-auto',
      'exit-plan-default',
      'reject',
    ]);
    const [plan] = await planDocuments(t.db, conversationId);
    expect(plan).toMatchObject({
      version: 1,
      status: 'approved',
      source: 'claude_plan_mode',
      body: FAKE_PLAN,
      approvedBy: 'user',
      approvedOption: 'exit-plan-default',
      approvedCommit: head(),
    });
    expect(plan!.taskId).not.toBeNull();
    const replies = await assistantReplies(conversationId);
    expect(replies.at(-1)?.content).toContain('Plan approved with exit-plan-default');
  });

  it('marks the plan rejected when the user keeps planning', async () => {
    start(null);
    const { conversationId } = await linkedConversation(t, root);
    const runId = await say(conversationId, 'Add CSV export #planmode #build');
    await driveToEnd(t, conversationId, runId, rejectPlans);
    const [plan] = await planDocuments(t.db, conversationId);
    expect(plan).toMatchObject({ status: 'rejected', approvedAt: null });
    expect((await assistantReplies(conversationId)).at(-1)?.content).toContain('Kept planning');
  });

  it('gives the next Builder the agreed plan, and the next session too', async () => {
    start(null);
    const { conversationId } = await linkedConversation(t, root);
    const first = await say(conversationId, 'Add CSV export #planmode #build');
    await driveToEnd(t, conversationId, first);
    const second = await say(conversationId, 'Now add the button #build');
    await driveToEnd(t, conversationId, second);
    const prompts = await builderPrompts(conversationId);
    expect(prompts[0]).not.toContain('## Agreed plan');
    expect(prompts.at(-1)).toContain('## Agreed plan');
    expect(prompts.at(-1)).toContain('- Add `src/export.ts` with a CSV writer');
    const third = await say(conversationId, 'What is left?', 'ask');
    await finished(third);
    const { rows } = await t.db.query<{ payload: string }>(
      `SELECT payload::text FROM run_protocol_log
       WHERE run_id = $1 AND method = 'session/prompt' AND direction = 'to_agent'`,
      [third],
    );
    expect(rows[0]?.payload).toContain('## Agreed plan');
  });
});

describe('native plan mode in Ask (B5)', { timeout: 60_000 }, () => {
  beforeEach(() => connectProviders(t, false));

  it('puts a read-only Claude chat in its plan mode and saves the plan it offers', async () => {
    start(null);
    const { conversationId } = await linkedConversation(t, root);
    const runId = await say(conversationId, 'Plan CSV export #nativeplan', 'ask');
    await finished(runId);
    const [plan] = await planDocuments(t.db, conversationId);
    expect(plan).toMatchObject({
      status: 'proposed',
      source: 'claude_plan_mode',
      body: FAKE_PLAN,
      sourceRunId: runId,
    });
    const replies = await assistantReplies(conversationId);
    expect(replies.at(-1)?.content).toContain('Kept planning');
    expect(await switchedToPlan(runId)).toBe(true);
  });

  it('drafts a plan-only request from a Do chat in plan mode and approves it from the plan card', async () => {
    harness = startOrchestrator(t, null);
    const { conversationId } = await linkedConversation(t, root);
    const runId = await say(
      conversationId,
      "Plan adding CSV export. Plan only for now: don't change any files. #nativeplan",
    );
    const { asked } = await driveToEnd(t, conversationId, runId);
    expect(asked.map((approval) => approval.title)).toEqual(['Approve the plan?']);
    expect(await planDocuments(t.db, conversationId)).toEqual([
      expect.objectContaining({ source: 'claude_plan_mode', body: FAKE_PLAN, status: 'approved' }),
    ]);
    expect(await switchedToPlan(runId)).toBe(true);
    expect(execFileSync('git', ['-C', root, 'status', '--porcelain']).toString()).toBe('');
  });
});

describe('the Critic on plan-driven and multi-file builds', { timeout: 60_000 }, () => {
  async function roles(runId: string): Promise<string[]> {
    const { rows } = await t.db.query<{ role: string }>(
      `SELECT role FROM runs WHERE parent_run_id = $1 ORDER BY created_at`,
      [runId],
    );
    return rows.map((row) => row.role);
  }

  it('reviews a build from the agreed plan with the plan, but not a one-liner', async () => {
    start(null);
    const { conversationId } = await linkedConversation(t, root);
    const first = await say(conversationId, 'Add CSV export #planmode #build');
    await driveToEnd(t, conversationId, first);
    expect(await roles(first)).toEqual(['builder']);
    const oneLiner = await say(conversationId, 'Fix the heading typo #build');
    await driveToEnd(t, conversationId, oneLiner);
    expect(await roles(oneLiner)).toEqual(['builder']);
    const planned = await say(conversationId, 'Do it: build the CSV export #build #feature');
    await driveToEnd(t, conversationId, planned);
    expect(await roles(planned)).toEqual(['builder', 'critic']);
    const { rows } = await t.db.query<{ prompt: string }>(
      `SELECT prompt FROM runs WHERE parent_run_id = $1 AND role = 'critic'`,
      [planned],
    );
    expect(rows[0]?.prompt).toContain('## Agreed plan');
  });

  it('reviews a multi-file story without a plan, and skips a two-file change in one place', async () => {
    start(null);
    const { conversationId } = await linkedConversation(t, root);
    const small = await say(conversationId, 'Add the export and its button #build #feature');
    await driveToEnd(t, conversationId, small);
    expect(await roles(small)).toEqual(['builder']);
    const { conversationId: other } = await linkedConversation(t, root);
    const story = await say(other, 'Tags on projects: DB, API and UI #build #story');
    await driveToEnd(t, other, story);
    expect(await roles(story)).toEqual(['builder', 'critic']);
  });
});

describe('plans agreed in chat', { timeout: 60_000 }, () => {
  beforeEach(() => connectProviders(t));

  it('saves the previous reply as the agreed plan when Jev is sure, and logs the regex baseline', async () => {
    const script = start(0.93);
    const { conversationId } = await linkedConversation(t, root);
    await finished(await say(conversationId, 'How would you add CSV export? #planreply', 'ask'));
    const [reply] = await assistantReplies(conversationId);
    const agreed = await say(conversationId, 'sounds good, go ahead', 'ask');
    await finished(agreed);
    const [plan] = await planDocuments(t.db, conversationId);
    expect(plan).toMatchObject({
      status: 'approved',
      source: 'chat',
      approvedBy: 'jev',
      sourceMessageId: reply!.id,
      approvedCommit: head(),
    });
    expect(plan!.body).toContain('Add `src/export.ts`');
    const [advice] = await planAdvice(agreed);
    expect(advice).toMatchObject({
      jev_status: 'not_asked',
      body: { applied: 'save', answer: { jev: 0.93, rule: true, action: 'save' } },
    });
    const planCall = script.calls.find((call) => call.questions.includes('plan_agreed'));
    expect(String(planCall?.state.previous_reply)).toContain('Shall I go ahead?');
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.plans).toEqual({ saved: [{ messageId: reply!.id, version: 1 }], offers: [] });
  });

  it('offers a "Save as agreed plan" card when Jev is unsure', async () => {
    start(0.7);
    const { conversationId } = await linkedConversation(t, root);
    await finished(await say(conversationId, 'Plan CSV export #planreply', 'ask'));
    const [reply] = await assistantReplies(conversationId);
    const agreed = await say(conversationId, 'hmm ok maybe', 'ask');
    await finished(agreed);
    expect(await planDocuments(t.db, conversationId)).toEqual([]);
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.plans?.offers).toEqual([{ runId: agreed, messageId: reply!.id }]);
  });

  it('does nothing below 0.6', async () => {
    start(0.2);
    const { conversationId } = await linkedConversation(t, root);
    await finished(await say(conversationId, 'Plan CSV export #planreply', 'ask'));
    const next = await say(conversationId, 'why step 2?', 'ask');
    await finished(next);
    expect(await planDocuments(t.db, conversationId)).toEqual([]);
    const [advice] = await planAdvice(next);
    expect(advice?.body).toMatchObject({ applied: 'none', answer: { jev: 0.2, rule: false } });
  });

  it('approves a proposed Codex plan instead of copying the reply', async () => {
    start(0.95);
    const { conversationId } = await linkedConversation(t, root);
    await finished(await say(conversationId, 'Plan CSV export #proposedplan', 'ask'));
    const [proposed] = await planDocuments(t.db, conversationId);
    expect(proposed).toMatchObject({ status: 'proposed', source: 'codex', body: FAKE_PLAN });
    await finished(await say(conversationId, 'yes', 'ask'));
    expect(await planDocuments(t.db, conversationId)).toEqual([
      expect.objectContaining({ id: proposed!.id, status: 'approved', approvedBy: 'jev' }),
    ]);
  });
});

describe('plans agreed in chat without Jev', { timeout: 60_000 }, () => {
  beforeEach(() => connectProviders(t, false));

  it('saves nothing on its own and still records the regex baseline', async () => {
    start(null);
    const { conversationId } = await linkedConversation(t, root);
    await finished(await say(conversationId, 'Plan CSV export #planreply', 'ask'));
    const next = await say(conversationId, 'yes, do it', 'ask');
    await finished(next);
    expect(await planDocuments(t.db, conversationId)).toEqual([]);
    const [advice] = await planAdvice(next);
    expect(advice).toMatchObject({
      jev_status: 'not_connected',
      body: { applied: 'none', answer: { jev: null, rule: true } },
    });
  });
});
