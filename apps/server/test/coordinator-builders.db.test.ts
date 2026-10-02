import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { currentPieceList } from '../src/persistence/pieces.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import { children, startPieces } from './coordinator-support.ts';
import {
  NORMAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await writeFile(join(root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

interface CountDecision {
  jev_status: string;
  jev_input_tokens: number | null;
  body: {
    summary: string;
    applied: string;
    questions: string[] | null;
    answer: {
      engage: boolean;
      builders: {
        applied: string;
        reason: string;
        asked: number | null;
        confidence: number | null;
        builders: number | null;
        groups: string[][] | null;
      } | null;
    };
  };
}

async function countDecision(runId: string): Promise<CountDecision> {
  const { rows } = await t.db.query<CountDecision>(
    `SELECT jev_status, jev_input_tokens, body FROM run_advice
     WHERE run_id = $1 AND purpose = 'parallel'`,
    [runId],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function run(jev: typeof fetch | null, text?: string) {
  const started = await startPieces(t, root, '#pieces', { jev, ...(text ? { text } : {}) });
  harness = started.harness;
  const { orchestration } = await driveToEnd(
    t,
    started.conversationId,
    started.runId,
    undefined,
    90_000,
  );
  return { runId: started.runId, orchestration };
}

async function listOf(runId: string) {
  const view = await loadOrchestration(t.db, runId);
  return currentPieceList(t.db, view!.taskId!);
}

describe('Jev picks the number of Builders', { timeout: 150_000 }, () => {
  it('runs one task Builder with the whole plan when Jev picks 1', async () => {
    const script: JevScript = { calls: [], scenario: NORMAL, choices: { builders: '1' } };
    const { runId, orchestration } = await run(
      jevFetch(script),
      'Build the store, the API and the view.',
    );
    expect(orchestration.status).toBe('succeeded');
    const crew = await children(t, runId);
    expect(crew.some((child) => child.role === 'coordinator')).toBe(false);
    expect(crew.some((child) => child.pieceKey !== null)).toBe(false);
    expect(crew.filter((child) => child.role === 'builder')).toHaveLength(1);
    expect(await listOf(runId)).toBeNull();
    const recorded = await countDecision(runId);
    expect(recorded.jev_status).toBe('answered');
    expect(recorded.jev_input_tokens).toBe(1000);
    expect(recorded.body.applied).toBe('jev');
    expect(recorded.body.summary).toBe('Coordinator: Jev: 1 Builder (0.73); one Builder');
    expect(recorded.body.questions).toEqual(expect.arrayContaining(['builders', 'T1_reasoning']));
    expect(recorded.body.answer).toMatchObject({
      engage: false,
      builders: { applied: 'jev', asked: 1, builders: 1, groups: [['T1', 'T2', 'T3']] },
    });
  });

  it('builds three pieces from three groups when Jev picks 3, with one Jev call', async () => {
    const script: JevScript = { calls: [], scenario: NORMAL, choices: { builders: '3' } };
    const { runId, orchestration } = await run(jevFetch(script));
    expect(orchestration.status).toBe('succeeded');
    expect(script.calls.filter((call) => call.questions.includes('builders'))).toHaveLength(1);
    expect(script.calls.some((call) => call.questions.includes('P1_reasoning'))).toBe(false);
    const list = (await listOf(runId))!;
    expect(list.pieces.map((piece) => [piece.key, piece.status])).toEqual([
      ['P1', 'landed'],
      ['P2', 'landed'],
      ['P3', 'landed'],
    ]);
    expect(list.placementReason).toMatch(/^Jev: 3 Builders \(0\.73\) · P1 /);
    const coordinator = (await children(t, runId)).find((child) => child.role === 'coordinator')!;
    expect(coordinator.prompt).toContain('## Builders\nSpark chose 3 Builders');
    expect(coordinator.prompt).toContain('- P2: API: build it in `api.ts`');
    const recorded = await countDecision(runId);
    expect(recorded.body.answer.builders).toMatchObject({
      applied: 'jev',
      asked: 3,
      builders: 3,
      groups: [['T1'], ['T2'], ['T3']],
    });
  });

  it('keeps the rules when Jev is unsure of the count', async () => {
    const script: JevScript = { calls: [], scenario: NORMAL };
    const { runId, orchestration } = await run(jevFetch(script));
    expect(orchestration.status).toBe('succeeded');
    const list = (await listOf(runId))!;
    expect(list.pieces).toHaveLength(3);
    expect(list.placementReason).not.toContain('Jev:');
    expect(list.pieces[0]!.pickNote).toBe(
      'Rules: Claude Sonnet 5 · Jev was unsure of the Builder count (0.20)',
    );
    const coordinator = (await children(t, runId)).find((child) => child.role === 'coordinator')!;
    expect(coordinator.prompt).not.toContain('## Builders');
    const recorded = await countDecision(runId);
    expect(recorded.jev_status).toBe('answered');
    expect(recorded.body.applied).toBe('rules');
    expect(recorded.body.answer).toMatchObject({
      engage: true,
      builders: { applied: 'rules', builders: null, groups: null },
    });
    expect(recorded.body.summary).toContain('Jev was unsure of the Builder count (0.20)');
  });

  it('keeps the rules without Jev', async () => {
    const { runId, orchestration } = await run(null);
    expect(orchestration.status).toBe('succeeded');
    expect((await listOf(runId))!.pieces).toHaveLength(3);
    const recorded = await countDecision(runId);
    expect(recorded.jev_status).toBe('not_connected');
    expect(recorded.body.answer.builders).toMatchObject({
      applied: 'rules',
      reason: 'Jev not connected',
      builders: null,
    });
  });
});
