import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
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
  const route = done.orchestration.decisions.find(
    (decision) => decision.kind === 'route' && decision.childRunId !== null,
  );
  return { ...done, runId: sent.run.id, route };
}

describe('escalating a hard follow-up in a long task session', () => {
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
