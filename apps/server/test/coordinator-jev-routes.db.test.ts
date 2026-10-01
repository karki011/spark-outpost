import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { createCodeScanner } from '../src/codescan/scanner.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import { children, pieceList, startPieces } from './coordinator-support.ts';
import {
  beginPieces,
  crewRuns,
  overlap,
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

async function runInOrder(jev: typeof fetch) {
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
  it('asks once about every piece and composes a different pick per piece', async () => {
    const script: JevScript = {
      calls: [],
      scenario: NORMAL,
      scores: { P1_reasoning: 3.5, P1_coding: 2.5, P2_reasoning: 4.5 },
    };
    const { runId, orchestration } = await runInOrder(jevFetch(script));
    expect(orchestration.status).toBe('succeeded');
    const batches = script.calls.filter((call) => call.questions.includes('P1_reasoning'));
    expect(batches).toHaveLength(1);
    expect(batches[0]!.questions).toEqual(
      expect.arrayContaining(['P1_kind', 'P1_coding', 'P2_context', 'P3_reliability']),
    );
    expect(batches[0]!.questions.some((key) => key.endsWith('_wide'))).toBe(false);
    expect(batches[0]!.questions.some((key) => key.endsWith('_builder'))).toBe(false);
    expect(String(batches[0]!.state.pieces)).toContain('Piece P2: API');
    expect(String(batches[0]!.state.pieces)).toContain('  Waits for: P1');
    expect(String(batches[0]!.state.pieces)).toContain('  - store.ts');

    const list = await pieceList(t, runId);
    expect(list.pieces.map((piece) => [piece.key, piece.provider, piece.model])).toEqual([
      ['P1', 'codex', 'gpt-6-sol'],
      ['P2', 'claude', 'opus[1m]'],
      ['P3', 'claude', 'sonnet'],
    ]);
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
      scores: { P3_reasoning: 3.5, P3_coding: 2.5 },
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

  it('moves one piece to its own worktree and lands the mixed list', async () => {
    const script: JevScript = {
      calls: [],
      scenario: NORMAL,
      policy: { P1_wide: 0.05, P2_wide: 0.9, P3_wide: 0.05 },
    };
    const { runId, orchestration } = await runParallel('', script);
    expect(orchestration.status).toBe('succeeded');
    const list = await pieceListOf(t, runId);
    expect(list.placement).toBe('shared');
    expect(list.placementReason).toContain('Jev moved P2');
    expect(list.pieces.map((piece) => [piece.key, piece.placement, piece.status])).toEqual([
      ['P1', 'shared', 'landed'],
      ['P2', 'worktree', 'landed'],
      ['P3', 'shared', 'landed'],
    ]);
    expect(list.pieces[1]!.filesChanged).toEqual(['api.ts']);
    const { rows: copies } = await t.db.query<{ key: string; copy: string | null }>(
      `SELECT route->>'pieceKey' AS key, route->>'copy' AS copy FROM runs
       WHERE parent_run_id = $1 AND route ? 'pieceKey' ORDER BY created_at`,
      [runId],
    );
    expect(copies.map((row) => [row.key, row.copy !== null])).toEqual([
      ['P1', false],
      ['P2', true],
      ['P3', false],
    ]);
    const runs = await crewRuns(t, runId);
    const first = (key: string) => runs.find((run) => run.pieceKey === key)!;
    expect(overlap(first('P1'), first('P2'))).toBe(true);
    expect(overlap(first('P1'), first('P3'))).toBe(false);
    const recorded = await decision(runId);
    expect(recorded.body.answer.pieces.map((piece) => piece.placement.decidedBy)).toEqual([
      'jev',
      'jev',
      'jev',
    ]);
  });
});

describe('likely files from the Jev ranking', { timeout: 150_000 }, () => {
  const HINT = 'Likely files (a ranking hint, not a limit):';

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
    expect(builder.prompt).toContain(`${HINT} store.ts (0.80)`);
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
    expect(prompts.get('P1')).toContain(`${HINT} store.ts (0.80)`);
    expect(prompts.get('P2')).toContain(`${HINT} store.ts (0.80)`);
    expect(prompts.get('P3')).not.toContain(HINT);
  });
});
