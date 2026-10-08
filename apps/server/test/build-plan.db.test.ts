import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLAN_SAVED_OPTION } from '@spark-outpost/contracts';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { insertPlanDocument, planDocuments } from '../src/persistence/plan-documents.ts';
import { linkedConversation } from './approval-support.ts';
import { pieceList } from './coordinator-support.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import {
  NORMAL,
  TRIVIAL,
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
import { createTestDb, pinChatLevel, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let store: string;
let harness: Harness;
let script: JevScript;
let conversationId: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await writeFile(join(root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
  script = { calls: [] };
  harness = startOrchestrator(t, jevFetch(script), {
    sessions: store,
    coordinator: 'in_order',
  });
  conversationId = (await linkedConversation(t, root)).conversationId;
  await t.db.query(`UPDATE conversations SET model_routing = 'auto' WHERE id = $1`, [
    conversationId,
  ]);
  await pinChatLevel(t.db, conversationId, 'full-auto');
});

afterEach(async () => {
  await harness.stop();
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

afterAll(async () => {
  await stopParseWorker();
});

async function turn(scenario: Scenario) {
  script.scenario = scenario;
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: scenario.text },
    {
      provider: 'claude',
      model: 'sonnet',
      effort: 'medium',
      permission: 'do',
      agentMode: 'auto',
      level: 'full-auto',
    },
  );
  harness.worker.wake();
  const done = await driveToEnd(t, conversationId, sent.run.id, () => null, 120_000);
  return { ...done, runId: sent.run.id };
}

async function planEvents(runId: string): Promise<{ version: number; status: string }[]> {
  const { rows } = await t.db.query<{ payload: { content: { version: number; status: string } } }>(
    `SELECT payload FROM run_events
     WHERE run_id = $1 AND payload->>'activityType' = 'plan_document' ORDER BY seq`,
    [runId],
  );
  return rows.map((row) => row.payload.content);
}

async function lines() {
  return (await getConversationDetail(t.db, conversationId))?.plans?.lines ?? [];
}

const PIECES = withTag(NORMAL, 'Split this up. #pieces');

describe('the plan of a build is saved as the agreed plan', { timeout: 200_000 }, () => {
  it("saves the Coordinator's piece list, shows one line, raises no card, and Jev picks each piece's model", async () => {
    script.scores = { P1_reasoning: 3.5, P1_coding: 2.5, P2_reasoning: 4.5 };
    const { asked, orchestration, runId } = await turn(PIECES);

    expect(orchestration.status).toBe('succeeded');
    expect(asked).toEqual([]);
    const waited = await t.db.query(
      `SELECT a.kind FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.conversation_id = $1 AND (a.decided_by = 'user' OR a.status = 'pending')`,
      [conversationId],
    );
    expect(waited.rows).toEqual([]);

    const plans = await planDocuments(t.db, conversationId);
    expect(plans).toEqual([
      expect.objectContaining({
        version: 1,
        status: 'approved',
        source: 'chat',
        approvedBy: 'jev',
        approvedOption: PLAN_SAVED_OPTION.pieces,
        sourceRunId: runId,
        body: [
          '1. Store: Build the store (`store.ts`)',
          '2. API: Build the api (`api.ts`)',
          '3. View: Build the view (`view.ts`)',
        ].join('\n'),
      }),
    ]);
    expect(await planEvents(runId)).toMatchObject([{ version: 1, status: 'approved' }]);
    expect(await planEvents(runId)).toHaveLength(1);
    expect(await lines()).toEqual([{ runId, version: 1, items: 3, unit: 'pieces' }]);

    const batches = script.calls.filter((call) => call.questions.includes('P1_reasoning'));
    expect(batches).toHaveLength(1);
    expect(batches[0]!.questions).toEqual(
      expect.arrayContaining(['P1_kind', 'P1_coding', 'P2_context', 'P3_reliability']),
    );
    expect(batches[0]!.questions).not.toContain('builders');
    const list = await pieceList(t, runId);
    expect(list.planVersion).toBe(1);
    expect(list.pieces.map((piece) => [piece.key, piece.provider, piece.model])).toEqual([
      ['P1', 'claude', 'sonnet'],
      ['P2', 'claude', 'opus[1m]'],
      ['P3', 'claude', 'sonnet'],
    ]);
    expect(list.pieces.map((piece) => piece.pickNote?.slice(0, 4))).toEqual([
      'Jev:',
      'Jev:',
      'Jev:',
    ]);
  });

  it('saves a different piece list in a later turn as a new version, with one line per turn', async () => {
    const first = await turn(PIECES);
    const second = await turn({ ...withTag(PIECES, '#docspiece'), continuesTask: 0.02 });

    expect(second.orchestration.status).toBe('succeeded');
    const plans = await planDocuments(t.db, conversationId);
    expect(plans.map((plan) => [plan.version, plan.status])).toEqual([
      [1, 'superseded'],
      [2, 'approved'],
    ]);
    expect(plans[1]!.body).toContain('3. View: Build the view (`README.md`)');
    expect(await lines()).toEqual([
      { runId: first.runId, version: 1, items: 3, unit: 'pieces' },
      { runId: second.runId, version: 2, items: 3, unit: 'pieces' },
    ]);
  });

  it("saves a single Builder's own plan entries once, however often it updates them", async () => {
    const { asked, orchestration, runId } = await turn(withTag(NORMAL, '#todos'));

    expect(orchestration.status).toBe('succeeded');
    expect(asked).toEqual([]);
    expect(await planDocuments(t.db, conversationId)).toEqual([
      expect.objectContaining({
        version: 1,
        status: 'approved',
        approvedOption: PLAN_SAVED_OPTION.steps,
        body: '1. Write the change\n2. Add a test\n3. Update the docs',
      }),
    ]);
    expect(await planEvents(runId)).toMatchObject([{ version: 1, status: 'approved' }]);
    expect(await planEvents(runId)).toHaveLength(1);
    expect(await lines()).toEqual([{ runId, version: 1, items: 3, unit: 'steps' }]);
  });

  it('saves nothing for a small change', async () => {
    const { orchestration } = await turn(withTag(TRIVIAL, '#todos'));

    expect(orchestration.status).toBe('succeeded');
    expect(await planDocuments(t.db, conversationId)).toEqual([]);
    expect(await lines()).toEqual([]);
  });

  it('shows one line for a plan revised within a turn, at its latest version', async () => {
    const { runId } = await turn(withTag(NORMAL, '#todos'));
    await insertPlanDocument(t.db, {
      conversationId,
      taskId: null,
      source: 'chat',
      body: '1. Write the change\n2. Add two tests',
      sourceRunId: runId,
      approval: { by: 'jev', option: PLAN_SAVED_OPTION.steps, runId, commit: null },
    });

    expect(await lines()).toEqual([{ runId, version: 2, items: 2, unit: 'steps' }]);
  });
});
