import { expectConformantRun } from './agui-conformance.ts';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  modeForLegacy,
  type AdviceBody,
  type InvolvementLevel,
  needsYouLine,
} from '@spark-outpost/contracts';
import { MAKE_CHANGE_RULE } from '../src/orchestration/context.ts';
import { NEEDS_YOU_NOTE } from '../src/orchestration/simple-intake.ts';
import { setConversationProjects } from '../src/persistence/conversation-projects.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { createProject } from '../src/projects/projects.ts';
import { linkedConversation } from './approval-support.ts';
import {
  TRIVIAL,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  withTag,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let other: string | null = null;
let harness: Harness | null = null;
let script: JevScript;
let store: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  script = { calls: [] };
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch(script), { sessions: store });
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  if (other) await removeRepo(other);
  other = null;
  rmSync(store, { recursive: true, force: true });
});

async function send(
  conversationId: string,
  scenario: Scenario,
  level: InvolvementLevel | null = null,
  extra: { startAs?: 'change' } = {},
) {
  script.scenario = scenario;
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: scenario.text, ...extra },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission: scenario.mode,
      agentMode: modeForLegacy('claude', scenario.mode, level),
      level: level ?? 'hands-off',
    },
  );
  return sent.run.id;
}

async function turn(
  conversationId: string,
  scenario: Scenario,
  extra: { startAs?: 'change' } = {},
) {
  const runId = await send(conversationId, scenario, null, extra);
  const done = await driveToEnd(t, conversationId, runId);
  return { ...done, runId };
}

async function approvalKinds(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ kind: string }>(
    `SELECT a.kind FROM approvals a JOIN runs r ON r.id = a.run_id
     WHERE r.id = $1 OR r.parent_run_id = $1`,
    [runId],
  );
  return rows.map((row) => row.kind);
}

async function intakeRead(runId: string): Promise<string | undefined> {
  const { rows } = await t.db.query<{ summary: string }>(
    `SELECT body->>'summary' AS summary FROM run_advice
     WHERE run_id = $1 AND purpose = 'route' AND child_run_id IS NULL`,
    [runId],
  );
  return rows[0]?.summary;
}

async function adviceOf(runId: string): Promise<AdviceBody> {
  const { rows } = await t.db.query<{ body: AdviceBody }>(
    `SELECT body FROM run_advice WHERE run_id = $1 AND purpose = 'intake'`,
    [runId],
  );
  return rows[0]!.body;
}

const PLAN_TALK: Scenario = {
  id: 'plan-talk',
  text: 'give me plan we can integrate',
  mode: 'do',
  destructive: 0.05,
  intent: 'feature',
  intentConfidence: 0.62,
  intentProbabilities: { feature: 0.62, question: 0.38 },
};

describe('answer first, with "Make the change" one click away', () => {
  it('answers an unsure Do request in place, then builds the same request on "change"', async () => {
    const { conversationId } = await linkedConversation(t, root);
    const answered = await turn(conversationId, PLAN_TALK);
    expect(answered.asked).toEqual([]);
    expect(answered.orchestration.crew.map((member) => member.role)).toEqual(['scout']);
    const run = await getRun(t.db, answered.runId);
    expect(run).toMatchObject({ mode: 'ask', pickedMode: 'do', startAs: null });
    const advice = await adviceOf(answered.runId);
    expect(advice.calls?.question).toMatchObject({ jev: 0.38, value: true, source: 'rules' });
    expect(advice.notAsked).toMatchObject({ continues_task: 'no current task' });

    const built = await turn(conversationId, withTag(PLAN_TALK, '#build'), { startAs: 'change' });
    expect(built.orchestration.crew.map((member) => member.role)).toContain('builder');
    expect(await getRun(t.db, built.runId)).toMatchObject({ pickedMode: 'do', startAs: 'change' });
    expect((await adviceOf(built.runId)).calls?.change).toMatchObject({ source: 'user' });
    const answer = await t.db.query<{ content: string }>(
      `SELECT content FROM messages WHERE run_id = $1 AND role = 'assistant'`,
      [answered.runId],
    );
    const builder = await t.db.query<{ prompt: string }>(
      `SELECT prompt FROM runs WHERE parent_run_id = $1 AND role = 'builder'`,
      [built.runId],
    );
    expect(builder.rows[0]?.prompt).toContain(MAKE_CHANGE_RULE);
    expect(builder.rows[0]?.prompt).toContain(
      `## Answer to apply\n${answer.rows[0]!.content.trim()}`,
    );
  }, 90_000);
});

describe('a vague follow-up', () => {
  const WRAP_UP: Scenario = { id: 'wrap', text: 'wrap up', mode: 'do', destructive: 0.02 };

  it('asks its questions in a read-only reply instead of building, with no card', async () => {
    const { conversationId } = await linkedConversation(t, root);
    await turn(conversationId, PLAN_TALK);
    const { asked, orchestration, runId } = await turn(conversationId, WRAP_UP);
    expect(asked).toEqual([]);
    expect(await approvalKinds(runId)).toEqual([]);
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.crew.map((member) => member.role)).toEqual(['scout']);
    expect((await adviceOf(runId)).calls?.vague).toMatchObject({ rule: true, value: true });
    expect(await intakeRead(runId)).toBe('intake read this as needs you');
    const { rows } = await t.db.query<{ text: string }>(
      `SELECT payload->'params'->'prompt'->0->>'text' AS text FROM run_protocol_log
       WHERE run_id = $1 AND method = 'session/prompt' AND kind = 'request'`,
      [runId],
    );
    expect(rows.map((row) => row.text).join('\n')).toContain(NEEDS_YOU_NOTE);
  }, 90_000);
});

describe('missing context', () => {
  it('says what it needs in the reply instead of retrying one tier up, with no card', async () => {
    const { conversationId } = await linkedConversation(t, root);
    const failing = withTag(TRIVIAL, '#build #nofile');
    const { asked, orchestration, runId } = await turn(conversationId, failing);
    expect(asked).toEqual([]);
    expect(await approvalKinds(runId)).toEqual([]);
    expect(orchestration.crew.map((member) => [member.role, member.model])).toEqual([
      ['builder', 'sonnet'],
    ]);
    expect(orchestration.status).toBe('succeeded');
    const replies = await assistantReplies(t, runId);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.endsWith(needsYouLine('There is no src/dates.ts in this repo.'))).toBe(true);
  }, 90_000);
});

describe('the project changes mid-chat', () => {
  it('records the roots per run, notes the move and resumes the chat session in the new folder', async () => {
    const { conversationId } = await linkedConversation(t, root);
    const first = await turn(conversationId, PLAN_TALK);
    expect(first.orchestration.status).toBe('succeeded');
    other = await gitRepo();
    const { project } = await createProject(t.db, t.workspaceId, other);
    await setConversationProjects(t.db, t.workspaceId, conversationId, [project.id]);
    const second = await turn(conversationId, PLAN_TALK);
    const { rows } = await t.db.query<{ id: string; project_roots: string[] }>(
      'SELECT id, project_roots FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL',
      [conversationId],
    );
    expect(rows.find((row) => row.id === first.runId)?.project_roots).toEqual([root]);
    expect(rows.find((row) => row.id === second.runId)?.project_roots).toEqual([other]);
    const steps = await t.db.query<{ name: string }>(
      `SELECT payload->>'stepName' AS name FROM run_events
       WHERE run_id = $1 AND payload->>'stepName' IS NOT NULL`,
      [second.runId],
    );
    const names = steps.rows.map((row) => row.name);
    expect(names.some((name) => name.startsWith('Project changed since the last turn:'))).toBe(
      true,
    );
    expect(names).toContain('Continued session');
    await expectConformantRun(t.db, second.runId);
    expect(names.filter((name) => name.startsWith('Fresh session'))).toEqual([]);
    const sessions = await t.db.query<{ agent_key: string; session_id: string }>(
      'SELECT DISTINCT agent_key, session_id FROM provider_sessions WHERE conversation_id = $1',
      [conversationId],
    );
    expect(sessions.rows.map((row) => row.agent_key)).toEqual(['chat:claude']);
  }, 90_000);
});
