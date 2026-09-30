import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { HANDOFF_HEADINGS } from '../src/orchestration/handoff.ts';
import {
  NORMAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

const FOLLOW_UP = 'Now rework the parser so totals handle several currencies. #build';

function hardFollowUp(contextDependence: number): Scenario {
  return {
    ...NORMAL,
    continuesTask: 0.95,
    tier: 'mid',
    ratings: { complexity: 4, ambiguity: 2, stakes: 2, context_dependence: contextDependence },
  };
}

interface BuilderRun {
  id: string;
  model: string;
  task_id: string;
  resume_key: string | null;
  escalation: { kind: string; model: string } | null;
  prompt: string;
}

async function builderRuns(runId: string): Promise<BuilderRun[]> {
  const { rows } = await t.db.query<BuilderRun>(
    `SELECT id, model, task_id, route->>'resumeKey' AS resume_key,
       route->'escalation' AS escalation, prompt
     FROM runs WHERE parent_run_id = $1 AND role = 'builder' ORDER BY created_at`,
    [runId],
  );
  return rows;
}

async function firstTask(contextTokens: number) {
  const script: JevScript = { calls: [], scenario: NORMAL };
  harness = startOrchestrator(t, jevFetch(script), { sessions: store });
  const first = await startScenario(t, root, NORMAL, 'hands-off');
  await driveToEnd(t, first.conversationId, first.runId);
  const [builder] = await builderRuns(first.runId);
  expect(builder).toMatchObject({ model: 'sonnet' });
  await t.db.query('UPDATE runs SET context_used = $2 WHERE id = $1', [builder!.id, contextTokens]);
  return { ...first, script, taskId: builder!.task_id };
}

async function followUp(conversationId: string, text = FOLLOW_UP) {
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: text },
    { provider: 'claude', model: 'sonnet', effort: 'medium', permission: 'do', level: 'hands-off' },
  );
  harness!.worker.wake();
  const done = await driveToEnd(t, conversationId, sent.run.id);
  const route = done.orchestration.decisions.find((decision) => decision.kind === 'route');
  return { ...done, runId: sent.run.id, route };
}

async function sessions(conversationId: string) {
  const { rows } = await t.db.query<{
    session_id: string;
    agent_key: string;
    close_reason: string | null;
  }>(
    `SELECT session_id, agent_key, close_reason FROM provider_sessions
     WHERE conversation_id = $1 ORDER BY created_at`,
    [conversationId],
  );
  return rows;
}

function prompts(sessionId: string): string[] {
  const stored = JSON.parse(readFileSync(join(store, `${sessionId}.json`), 'utf8')) as {
    prompts: string[];
  };
  return stored.prompts;
}

describe('escalating a hard follow-up in a long task session', () => {
  it('spawns a stronger Builder with a brief at large context and keeps the chat session warm', async () => {
    const first = await firstTask(180_000);
    first.script.scenario = hardFollowUp(2);
    const second = await followUp(first.conversationId);
    expect(second.orchestration.status).toBe('succeeded');

    const [builder] = await builderRuns(second.runId);
    expect(builder).toMatchObject({
      model: 'opus[1m]',
      task_id: first.taskId,
      resume_key: `${first.taskId}:escalated`,
      escalation: { kind: 'brief', model: 'opus[1m]' },
    });
    expect(builder!.prompt).toContain(HANDOFF_HEADINGS.brief);
    for (const heading of ['## Goal', '## Rules', '## Decisions so far', '## Current diff']) {
      expect(builder!.prompt).toContain(heading);
    }
    expect(builder!.prompt).toContain(FOLLOW_UP);

    const rows = await sessions(first.conversationId);
    const main = rows.find((row) => row.agent_key === `key:${first.taskId}:builder`);
    const escalated = rows.find((row) => row.agent_key === `key:${first.taskId}:escalated`);
    expect(main?.close_reason).toBeNull();
    expect(escalated?.close_reason).toBeNull();
    expect(prompts(main!.session_id)).toHaveLength(1);

    expect(second.route?.answer.rule).toBe(
      'hard follow-up at 180K → Opus 5.5 Builder with brief; Sonnet 5 session kept warm',
    );
    expect(second.route?.answer.why).toContain('Builder with brief');
    expect(second.route?.answer.escalation).toMatchObject({
      kind: 'brief',
      hard: true,
      contextTokens: 180_000,
      from: { model: 'sonnet' },
      to: { model: 'opus[1m]' },
    });
    expect(second.route?.answer.session).toMatchObject({ kept: true });

    first.script.scenario = {
      ...NORMAL,
      continuesTask: 0.95,
      ratings: { complexity: 2, ambiguity: 2, stakes: 2, context_dependence: 2 },
    };
    const third = await followUp(first.conversationId, 'Also rename the helper. #build');
    const [back] = await builderRuns(third.runId);
    expect(back).toMatchObject({ model: 'sonnet', resume_key: `${first.taskId}:builder` });
    const resumed = prompts(main!.session_id);
    expect(resumed).toHaveLength(2);
    expect(resumed[1]).toContain('handled the last request in this task from a brief');
    expect(resumed[1]).toContain('Also rename the helper.');
  }, 90_000);

  it('compacts and switches the session when the follow-up depends on the context', async () => {
    const first = await firstTask(180_000);
    first.script.scenario = hardFollowUp(4);
    const second = await followUp(first.conversationId);
    expect(second.orchestration.status).toBe('succeeded');

    const [builder] = await builderRuns(second.runId);
    expect(builder).toMatchObject({
      model: 'opus[1m]',
      resume_key: `${first.taskId}:builder`,
      escalation: { kind: 'compact', model: 'opus[1m]' },
    });
    const rows = await sessions(first.conversationId);
    const keyed = rows.filter((row) => row.agent_key === `key:${first.taskId}:builder`);
    expect(keyed).toHaveLength(2);
    expect(keyed[0]!.close_reason).not.toBeNull();
    expect(keyed[1]!.close_reason).toBeNull();
    const handoff = prompts(keyed[1]!.session_id);
    expect(handoff).toHaveLength(1);
    expect(handoff[0]).toContain(HANDOFF_HEADINGS.compact);
    expect(handoff[0]).toContain('## Recent turns, verbatim');
    expect(handoff[0]).toContain(FOLLOW_UP);
    expect(second.route?.answer.rule).toBe(
      'hard follow-up at 180K → compacted handoff; session moves to Opus 5.5',
    );
  }, 90_000);

  it('switches the session directly when the context is small', async () => {
    const first = await firstTask(20_000);
    first.script.scenario = hardFollowUp(4);
    const second = await followUp(first.conversationId);
    expect(second.orchestration.status).toBe('succeeded');

    const [builder] = await builderRuns(second.runId);
    expect(builder).toMatchObject({
      model: 'opus[1m]',
      resume_key: `${first.taskId}:builder`,
      escalation: { kind: 'switch', model: 'opus[1m]' },
    });
    expect(builder!.prompt).not.toContain(HANDOFF_HEADINGS.brief);
    expect(builder!.prompt).not.toContain(HANDOFF_HEADINGS.compact);
    expect(second.route?.answer.rule).toMatch(/^score → top tier/);
    expect(second.route?.answer.session).toMatchObject({ kept: false });
  }, 90_000);
});
