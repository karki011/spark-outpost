import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { createCodeScanner } from '../src/codescan/scanner.ts';
import { JEV_NOT_CONNECTED } from '../src/coordinator/builder-jev.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import { children, pieceList, startPieces } from './coordinator-support.ts';
import {
  beginPieces,
  pieceListOf,
  pieceRepo,
  projectFlags,
} from './coordinator-parallel-support.ts';
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

afterAll(async () => {
  await stopParseWorker();
});

interface PieceDecision {
  jev_status: string;
  body: {
    summary: string;
    applied: string;
    jevError: string | null;
    answer: {
      pieces: {
        key: string;
        decidedBy: string;
        reason: string;
        jevPick: { model: string } | null;
        pick: { provider: string; model: string };
        placement: { placement: string; decidedBy: string };
        signals: unknown;
        demand: unknown;
      }[];
    };
  };
}

async function decision(runId: string): Promise<PieceDecision> {
  const { rows } = await t.db.query<PieceDecision>(
    `SELECT jev_status, body FROM run_advice WHERE run_id = $1 AND purpose = 'piece_route'`,
    [runId],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

interface RouteRecord {
  child_run_id: string;
  summary: string;
  applied: string;
  routed_by: string;
  would_use: unknown;
}

async function routeRecords(runId: string): Promise<Map<string, RouteRecord>> {
  const { rows } = await t.db.query<RouteRecord>(
    `SELECT a.child_run_id, a.body->>'summary' AS summary, a.body->>'applied' AS applied,
            r.route->>'routedBy' AS routed_by, r.route->'autoWouldUse' AS would_use
     FROM run_advice a JOIN runs r ON r.id = a.child_run_id
     WHERE a.run_id = $1 AND a.purpose = 'route'`,
    [runId],
  );
  return new Map(rows.map((row) => [row.child_run_id, row]));
}

function failingPieceQuestions(script: JevScript, failure: 'status' | 'hang'): typeof fetch {
  const answer = jevFetch(script);
  return async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
    if (!Object.keys(body.questions).some((key) => key.endsWith('_reasoning'))) {
      return answer(input, init);
    }
    if (failure === 'status') return new Response('down', { status: 503 });
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    });
  };
}

async function runInOrder(jev: typeof fetch | null) {
  const started = await startPieces(t, root, '#pieces', { jev });
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

describe('Jev routes each piece', { timeout: 150_000 }, () => {
  it('asks once about every plan item and composes a different pick per piece', async () => {
    const script: JevScript = {
      calls: [],
      scenario: NORMAL,
      choices: { builders: '3' },
      scores: { T1_reasoning: 3.5, T1_coding: 2.5, T2_reasoning: 4.5 },
    };
    const { runId, orchestration } = await runInOrder(jevFetch(script));
    expect(orchestration.status).toBe('succeeded');
    const batches = script.calls.filter((call) => call.questions.includes('T1_reasoning'));
    expect(batches).toHaveLength(1);
    expect(script.calls.some((call) => call.questions.includes('P1_reasoning'))).toBe(false);
    expect(batches[0]!.questions).toEqual(
      expect.arrayContaining(['builders', 'T1_kind', 'T1_coding', 'T2_context', 'T3_reliability']),
    );
    expect(String(batches[0]!.state.pieces)).toContain('Piece T2: API: build it in `api.ts`');
    expect(String(batches[0]!.state.pieces)).toContain('  - store.ts');

    const list = await pieceList(t, runId);
    expect(list.pieces.map((piece) => [piece.key, piece.provider, piece.model])).toEqual([
      ['P1', 'codex', 'gpt-6-sol'],
      ['P2', 'claude', 'opus[1m]'],
      ['P3', 'claude', 'sonnet'],
    ]);
    expect(list.placementReason).toContain(
      'Jev: 3 Builders (0.73) · P1 Codex 6 Sol · P2 Claude Opus 5.5 · P3 Claude Sonnet 5; pieces run in order',
    );
    expect(list.pieces.map((piece) => piece.pickNote)).toEqual([
      'Jev: reasoning 3.5, coding 2.5, context 2 → mid tier → Codex 6 Sol (strong at reasoning)',
      'Jev: reasoning 4.5, coding 2, context 2 → top tier (deep reasoning) → Claude Opus 5.5 (only top-tier route)',
      "Jev: reasoning 2, coding 2, context 2 → demand low → mid route → Claude Sonnet 5 (the chat's provider)",
    ]);
    const builders = (await children(t, runId)).filter((child) => child.pieceKey);
    expect(builders.map((child) => [child.pieceKey, child.provider])).toEqual([
      ['P1', 'codex'],
      ['P2', 'claude'],
      ['P3', 'claude'],
    ]);
    const records = await routeRecords(runId);
    for (const builder of builders) {
      const note = list.pieces.find((piece) => piece.key === builder.pieceKey)!.pickNote!;
      expect(records.get(builder.id)).toMatchObject({
        applied: 'jev',
        routed_by: 'jev',
        would_use: null,
      });
      expect(records.get(builder.id)!.summary).toContain(note);
      expect(records.get(builder.id)!.summary).not.toContain('pinned');
    }

    const recorded = await decision(runId);
    expect(recorded.jev_status).toBe('answered');
    expect(recorded.body.applied).toBe('jev');
    expect(recorded.body.answer.pieces.map((piece) => [piece.key, piece.decidedBy])).toEqual([
      ['P1', 'jev'],
      ['P2', 'jev'],
      ['P3', 'jev'],
    ]);
    expect(recorded.body.answer.pieces[1]).toMatchObject({
      signals: { reasoning: { mean: 4.5 }, coding: { mean: 2 } },
      demand: { tier: 'top', raisedBy: 'deep reasoning', capability: 'reasoning' },
    });
  });

  it('keeps the rules when Jev fails, and records why', async () => {
    const script: JevScript = {
      calls: [],
      scenario: NORMAL,
    };
    const { runId, orchestration } = await runInOrder(failingPieceQuestions(script, 'status'));
    expect(orchestration.status).toBe('succeeded');
    const list = await pieceList(t, runId);
    expect(list.pieces.map((piece) => [piece.provider, piece.model])).toEqual([
      ['claude', 'sonnet'],
      ['claude', 'sonnet'],
      ['claude', 'sonnet'],
    ]);
    expect(list.pieces[0]!.pickNote).toBe(
      'Rules: Claude Sonnet 5 · Jev failed: TypeSafe responded with 503.',
    );
    const recorded = await decision(runId);
    expect(recorded.jev_status).toBe('failed');
    expect(recorded.body.jevError).toBe('TypeSafe responded with 503.');
    expect(recorded.body.applied).toBe('rules');
  });

  it('says Jev is not connected, on the pieces and in the summary alike', async () => {
    const { runId, orchestration } = await runInOrder(null);
    expect(orchestration.status).toBe('succeeded');
    const recorded = await decision(runId);
    expect(recorded.jev_status).toBe('not_connected');
    expect(recorded.body.summary).toBe(`Piece routes by rules (${JEV_NOT_CONNECTED})`);
    expect(new Set(recorded.body.answer.pieces.map((piece) => piece.reason))).toEqual(
      new Set([JEV_NOT_CONNECTED]),
    );
  });

  it('times out a silent Jev before the piece list waits on it', async () => {
    const script: JevScript = { calls: [], scenario: NORMAL };
    const { runId, orchestration } = await runInOrder(failingPieceQuestions(script, 'hang'));
    expect(orchestration.status).toBe('succeeded');
    const recorded = await decision(runId);
    expect(recorded.jev_status).toBe('timed_out');
    expect(recorded.body.answer.pieces.every((piece) => piece.decidedBy === 'rules')).toBe(true);
    expect((await pieceList(t, runId)).pieces[0]!.pickNote).toBe(
      'Rules: Claude Sonnet 5 · Jev timed out',
    );
  });
});

describe('Jev routes parallel pieces', { timeout: 150_000 }, () => {
  beforeEach(async () => {
    await pieceRepo(root);
  });

  async function runParallel(tags: string, script: JevScript) {
    await projectFlags(t, root, { parallel: true });
    const begun = beginPieces(t, root, tags, { jev: jevFetch(script) });
    harness = begun.harness;
    const { conversationId, runId } = await begun.started;
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 120_000);
    return { runId, orchestration };
  }

  it('sends a piece that owns a migration to the top tier, whatever its ratings', async () => {
    const script: JevScript = {
      calls: [],
      scenario: NORMAL,
      choices: { builders: '3' },
      scores: { T3_reasoning: 3.5, T3_coding: 2.5 },
    };
    const { runId, orchestration } = await runParallel('#migrations', script);
    expect(orchestration.status).toBe('succeeded');
    const list = await pieceListOf(t, runId);
    expect(list.pieces[0]).toMatchObject({ provider: 'claude', model: 'opus[1m]' });
    expect(list.pieces[0]!.pickNote).toContain(
      'reasoning 2, coding 2, context 2 → top tier (destructive) → Claude Opus 5.5',
    );
    expect(list.pieces[2]).toMatchObject({ provider: 'codex', model: 'gpt-6-sol' });
    const recorded = await decision(runId);
    expect(recorded.body.answer.pieces[0]).toMatchObject({
      decidedBy: 'jev',
      pick: { model: 'opus[1m]' },
      demand: { tier: 'top', raisedBy: 'destructive' },
    });
  });
});

describe('likely files from the Jev ranking', { timeout: 150_000 }, () => {
  const HINT = 'Likely code (a ranking hint, not a limit)';
  const STORE = /\d\. store\.ts \|[^\n]*\| Jev 0\.80/;

  beforeEach(async () => {
    await writeFile(
      join(root, 'store.ts'),
      'export function dayDivider(at: number) { return at; }\n',
    );
    await writeFile(
      join(root, 'midnight.ts'),
      "import { dayDivider } from './store';\nexport const midnight = dayDivider(0);\n",
    );
  });

  it('gives a single Builder the top ranked files with their probabilities', async () => {
    const scanner = createCodeScanner(t.db, { deadlineMs: 10_000 });
    const script: JevScript = { calls: [], scenario: NORMAL, choices: { likely_file: 'store.ts' } };
    harness = startOrchestrator(t, jevFetch(script), { codeScan: scanner });
    const { conversationId, runId } = await startScenario(t, root, NORMAL, 'full-auto', 'auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    await scanner.idle();
    expect(orchestration.status).toBe('succeeded');
    const builder = (await children(t, runId)).find((child) => child.role === 'builder')!;
    expect(builder.prompt).toContain(HINT);
    expect(builder.prompt).toMatch(STORE);
    expect(builder.prompt).toContain('<code_evidence>');
  });

  it('gives each piece only the ranked files it owns or reads', async () => {
    const scanner = createCodeScanner(t.db, { deadlineMs: 10_000 });
    const script: JevScript = { calls: [], scenario: NORMAL, choices: { likely_file: 'store.ts' } };
    const started = await startPieces(t, root, '#pieces', {
      jev: jevFetch(script),
      codeScan: scanner,
    });
    harness = started.harness;
    const { orchestration } = await driveToEnd(
      t,
      started.conversationId,
      started.runId,
      undefined,
      90_000,
    );
    await scanner.idle();
    expect(orchestration.status).toBe('succeeded');
    const prompts = new Map(
      (await children(t, started.runId))
        .filter((child) => child.pieceKey)
        .map((child) => [child.pieceKey, child.prompt]),
    );
    expect(prompts.get('P1')).toMatch(STORE);
    expect(prompts.get('P2')).toMatch(STORE);
    expect(prompts.get('P3')).not.toContain(HINT);
  });
});
