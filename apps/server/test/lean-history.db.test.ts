import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyticsHarnessSchema, orchestrationSchema } from '@spark-outpost/contracts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { createTestApp, HOST } from './app-support.ts';
import {
  SCENARIOS,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const TRIVIAL = SCENARIOS[1] as Scenario;

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function addHistory(runId: string): Promise<void> {
  await t.db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, parent_run_id,
       role, step_index, attempt, agent_label, route, finished_at)
     SELECT gen_random_uuid(), conversation_id, user_message_id, 'claude', 'succeeded', id,
       'architect', 0, 1, 'Sketch · Architect · Opus 5.5 · high',
       '{"name":"Sketch","parallelGroup":"g1","rereads":2,"planStep":"Plan"}', now()
     FROM runs WHERE id = $1`,
    [runId],
  );
  for (const purpose of ['transition', 'parallel', 'watchdog', 'build_style']) {
    await t.db.query(
      `INSERT INTO run_advice (run_id, purpose, jev_status, body)
       VALUES ($1, $2, 'answered', $3)`,
      [runId, purpose, JSON.stringify({ summary: `old ${purpose}`, applied: 'jev', answer: {} })],
    );
  }
  for (const [kind, option] of [
    ['plan', 'approve'],
    ['stuck', 'nudge'],
    ['merge_conflict', 'reconcile'],
  ] as const) {
    await t.db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
         status, decision_option_id, scope, decided_by, decided_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'h', $6, 'allowed', $7, 'once', 'user', now())`,
      [
        runId,
        `checkpoint:${kind}:old`,
        kind,
        `Old ${kind}`,
        JSON.stringify({
          command: null,
          cwd: null,
          paths: [],
          diffs: [],
          truncated: false,
          checkpoint: { kind, question: 'Old?', reason: 'history' },
        }),
        JSON.stringify([{ optionId: option, name: option, kind: 'allow_once' }]),
        option,
      ],
    );
  }
}

describe('history from before round 10', () => {
  it('still loads through the orchestration, conversation and analytics views', async () => {
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: TRIVIAL }));
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'full-auto');
    await driveToEnd(t, conversationId, runId);
    await addHistory(runId);

    const view = await loadOrchestration(t.db, runId);
    expect(orchestrationSchema.safeParse(view).success).toBe(true);
    expect(view?.crew.map((member) => member.role)).toContain('architect');
    expect(view?.decisions.map((decision) => decision.kind)).toEqual(
      expect.arrayContaining(['transition', 'parallel', 'watchdog', 'build_style']),
    );
    expect(view?.checkpoints.map((checkpoint) => checkpoint.kind)).toEqual(
      expect.arrayContaining(['plan', 'stuck', 'merge_conflict']),
    );

    const detail = await getConversationDetail(t.db, conversationId);
    expect(Object.keys(detail?.orchestrations ?? {})).toEqual([runId]);

    const app = createTestApp(t);
    const harnessTab = await request(app)
      .get('/api/analytics/harness?range=7d&tz=UTC')
      .set('Host', HOST)
      .expect(200);
    expect(analyticsHarnessSchema.safeParse(harnessTab.body).success).toBe(true);
    const audit = await request(app)
      .get(`/api/conversations/${conversationId}/audit/summary`)
      .set('Host', HOST);
    expect(audit.status).toBe(200);
  }, 60_000);
});
