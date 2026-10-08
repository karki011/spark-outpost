import { conversationAdvice } from '../src/persistence/advice.ts';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modeForLegacy } from '@spark-outpost/contracts';
import { CODEX_INSTRUCTIONS_METHOD } from '../src/agents/acp/spark-instructions.ts';
import { listProtocolLog } from '../src/persistence/audit-log.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import {
  QUESTION,
  RISKY,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

interface SessionReport {
  meta: { systemPrompt?: { append?: string } } | null;
  codexConfig: string | null;
}

let t: TestDb;
let root: string;
let harness: Harness | null = null;
let jev: JevScript;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t);
  jev = { calls: [] };
  harness = startOrchestrator(t, jevFetch(jev));
  await updateProfile(t.db, t.workspaceId, { displayName: 'Sam Rivera', personality: 'playful' });
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function finished(runId: string) {
  return eventually(async () => {
    const run = await getRun(t.db, runId);
    return run?.finishedAt ? run : null;
  }, 30_000);
}

function sessionOf(reply: string): SessionReport {
  const json = reply.slice(reply.indexOf('session=') + 'session='.length).split('\n')[0]!;
  return JSON.parse(json) as SessionReport;
}

async function childModels(runId: string) {
  const { rows } = await t.db.query<{ role: string; model: string | null }>(
    'SELECT role, model FROM runs WHERE parent_run_id = $1 ORDER BY created_at',
    [runId],
  );
  return rows.map((row) => [row.role, row.model]);
}

describe('Spark on', () => {
  it('still asks Jev and sends Spark instructions to the agent', async () => {
    const scenario = withTag(QUESTION, '#session');
    const { conversationId, runId } = await startScenario(t, root, scenario, null);
    await driveToEnd(t, conversationId, runId);
    expect(jev.calls.length).toBeGreaterThan(0);
    const [reply] = await assistantReplies(t, runId);
    const append = sessionOf(reply!).meta?.systemPrompt?.append ?? '';
    expect(append).toContain("The user's name is Sam; use it sparingly");
    expect(append).toContain('with the Agent tool');
    expect(append).toContain('light humour');
  }, 60_000);
});

describe('Spark off', () => {
  beforeEach(async () => {
    await updateProfile(t.db, t.workspaceId, { sparkEnabled: false });
  });

  it('answers with the chat’s own model in one turn, without Jev or a crew', async () => {
    const scenario = withTag(QUESTION, '#session');
    const { runId } = await startScenario(t, root, scenario, null, 'auto', 'haiku');
    const run = await finished(runId);
    expect(run.status).toBe('succeeded');
    expect(run.model).toBe('haiku');
    expect(jev.calls).toEqual([]);
    expect((await loadOrchestration(t.db, runId))?.crew).toEqual([]);
    expect(await childModels(runId)).toEqual([]);
    const [reply] = await assistantReplies(t, runId);
    const append = sessionOf(reply!).meta?.systemPrompt?.append ?? '';
    expect(append).toBe('');
  }, 60_000);

  it('builds risky work once on the chat’s model with no Critic, retry or Jev', async () => {
    const { conversationId, runId } = await startScenario(t, root, RISKY, 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(jev.calls).toEqual([]);
    expect(orchestration.risk).toBe('destructive');
    expect(orchestration.crew.map((member) => [member.role, member.model])).toEqual([
      ['builder', 'sonnet'],
    ]);
    const route = orchestration.decisions.find(
      (decision) => decision.kind === 'route' && decision.childRunId !== null,
    );
    expect(route?.summary).toContain('Spark off → your pick');
    const advice = (await conversationAdvice(t.db, conversationId)).byRun[runId];
    expect(advice).toMatchObject({ jevStatus: 'not_asked', jevError: 'Spark is off', jev: null });
  }, 60_000);

  it('sends Codex no developer instructions of its own', async () => {
    const { conversationId } = await linkedConversation(t, root);
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: `${QUESTION.text} #session` },
      {
        provider: 'codex',
        model: 'gpt-6-sol',
        effort: 'medium',
        permission: 'ask',
        agentMode: modeForLegacy('codex', 'ask', null),
        level: 'hands-off',
      },
    );
    const runId = sent.run.id;
    await finished(runId);
    const [reply] = await assistantReplies(t, runId);
    const config = JSON.parse(sessionOf(reply!).codexConfig ?? '{}') as {
      developer_instructions?: string;
    };
    expect(config.developer_instructions).toBeUndefined();
    const { entries } = await listProtocolLog(t.db, runId, {
      after: 0,
      limit: 50,
      direction: 'harness',
      method: CODEX_INSTRUCTIONS_METHOD,
    });
    expect(entries).toEqual([]);
  }, 60_000);
});
