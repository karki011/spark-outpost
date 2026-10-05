import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHARED_INSTALL_REASON } from '../src/approvals/piece-guard.ts';
import { NOT_STARTED_STOPPED } from '../src/coordinator/skip.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { currentPieceList } from '../src/persistence/pieces.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import { taskChanges } from '../src/projects/task-changes.ts';
import {
  beginPieces,
  crewRuns,
  overlap,
  pieceListOf,
  pieceRepo,
  projectFlags,
} from './coordinator-parallel-support.ts';
import { TARGETED_CHECK } from './fake-acp-coordinator.ts';
import {
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  removeRepo,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await pieceRepo(root);
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

const CLAUDE_MODES = [
  ['read-only', 'Ask first', null, null],
  ['ask-every-action', 'Ask every time', null, null],
  ['agent', 'Agent', null, 'auto_review'],
  ['default', 'Manual', null, 'standard'],
  ['acceptEdits', 'Accept edits', null, 'standard'],
  ['auto', 'Auto', null, null],
  ['plan', 'Plan', null, 'plan'],
  ['bypassPermissions', 'Bypass permissions', null, 'full_access'],
];

async function sharedGuards(runId: string): Promise<Record<string, boolean>> {
  const { rows } = await t.db.query<{ key: string; shares: boolean }>(
    `SELECT route->>'pieceKey' AS key, COALESCE((route->'guard'->>'sharesTree')::boolean, false) AS shares
       FROM runs WHERE parent_run_id = $1 AND route ? 'guard' AND route ? 'pieceKey'`,
    [runId],
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.shares]));
}

async function begin(tags: string, options: Parameters<typeof beginPieces>[3] = {}) {
  const begun = beginPieces(t, root, tags, options);
  harness = begun.harness;
  return begun.started;
}

describe('shared-tree parallel pieces', { timeout: 120_000 }, () => {
  it('runs independent pieces at once, holds a dependent back, and lands each with its own changes', async () => {
    await projectFlags(t, root, { parallel: true });
    const { conversationId, runId } = await begin('');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const list = await pieceListOf(t, runId);
    expect(list).toMatchObject({ placement: 'shared', status: 'approved' });
    expect(list.pieces.map((piece) => [piece.key, piece.status, piece.filesChanged])).toEqual([
      ['P1', 'landed', ['store.ts']],
      ['P2', 'landed', ['api.ts']],
      ['P3', 'landed', ['view.ts']],
    ]);
    const runs = await crewRuns(t, runId);
    const first = (key: string) => runs.find((run) => run.pieceKey === key)!;
    expect(overlap(first('P1'), first('P2'))).toBe(true);
    expect(first('P3').startedAt!.getTime()).toBeGreaterThanOrEqual(
      Date.parse(list.pieces[0]!.landedAt!),
    );
    expect(new Set([first('P1').slot, first('P2').slot])).toEqual(new Set(['1', '2']));
    expect(orchestration.crew.filter((member) => member.pieceKey).map((m) => m.placement)).toEqual([
      'shared',
      'shared',
      'shared',
    ]);
    const changes = await taskChanges(t.db, t.workspaceId, orchestration.taskId!);
    const filesOf = (key: string) => {
      const builder = list.pieces.find((piece) => piece.key === key)!.builderRunId;
      return changes.runs.find((run) => run.runId === builder)?.files.map((file) => file.path);
    };
    expect([filesOf('P1'), filesOf('P2'), filesOf('P3')]).toEqual([
      ['store.ts'],
      ['api.ts'],
      ['view.ts'],
    ]);
    const reply = (await assistantReplies(t, runId)).at(-1);
    expect(reply).toContain('Pieces (3, in the shared tree, list v1)');
    expect(reply).toContain('| P2 · API | Rivet | shared tree · owns 3 files |');
    expect(await sharedGuards(runId)).toEqual({ P1: true, P2: true, P3: true });
  });

  it("holds an install while pieces share the tree and says it was Spark's policy", async () => {
    await projectFlags(t, root, { parallel: true });
    const { conversationId, runId } = await begin('#addpkg');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ status: string; decided_by: string; reason: string }>(
      `SELECT a.status, a.decided_by, a.reason FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.parent_run_id = $1 AND a.title = 'pnpm add left-pad'`,
      [runId],
    );
    expect(rows).toEqual([
      { status: 'denied', decided_by: 'policy', reason: SHARED_INSTALL_REASON },
    ]);
    const steps = await t.db.query<{ name: string }>(
      `SELECT e.payload->>'stepName' AS name FROM run_events e JOIN runs r ON r.id = e.run_id
       WHERE r.parent_run_id = $1 AND e.type = 'STEP_STARTED' AND e.payload->>'stepName' LIKE 'Spark''s policy blocked%'`,
      [runId],
    );
    expect(steps.rows.map((row) => row.name)).toEqual([
      `Spark's policy blocked \`pnpm add left-pad\` (${SHARED_INSTALL_REASON})`,
    ]);
  });

  it("answers a piece's targeted check itself in Auto and refuses a whole-workspace run", async () => {
    await projectFlags(t, root, { parallel: true });
    const { conversationId, runId } = await begin('#targeted #allnx', {
      agentMode: 'auto',
      routing: 'pinned',
      agentEnv: { FAKE_ACP_MODES: JSON.stringify(CLAUDE_MODES) },
    });
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ title: string; status: string; decided_by: string }>(
      `SELECT a.title, a.status, a.decided_by FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.parent_run_id = $1 AND a.kind = 'execute' ORDER BY a.created_at`,
      [runId],
    );
    expect(rows).toEqual([
      { title: TARGETED_CHECK, status: 'allowed', decided_by: 'level' },
      { title: 'npx nx run-many --target=test', status: 'denied', decided_by: 'policy' },
    ]);
  });

  it('keeps pieces in order while the project runs one Builder at a time', async () => {
    await projectFlags(t, root, { slots: 1 });
    const { conversationId, runId } = await begin('');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const list = await pieceListOf(t, runId);
    expect(list).toMatchObject({
      placement: 'in_order',
      placementReason: 'this project runs one Builder at a time',
    });
    const runs = await crewRuns(t, runId);
    const first = (key: string) => runs.find((run) => run.pieceKey === key)!;
    expect(overlap(first('P1'), first('P2'))).toBe(false);
    expect(await sharedGuards(runId)).toEqual({ P1: false, P2: false, P3: false });
  });

  it('stops every running piece when you press Stop mid-group', async () => {
    await projectFlags(t, root, { parallel: true });
    const { conversationId, runId } = await begin('#slowpieces');
    const driving = driveToEnd(t, conversationId, runId, undefined, 90_000);
    await eventually(async () => {
      const taskId = (await loadOrchestration(t.db, runId))?.taskId;
      const list = taskId ? await currentPieceList(t.db, taskId) : null;
      const running = list?.pieces.filter((piece) => piece.status === 'running') ?? [];
      return running.length === 2 ? list : null;
    }, 60_000);
    await requestCancel(t.db, runId);
    const { orchestration } = await driving;
    expect(orchestration.status).toBe('cancelled');
    const list = await pieceListOf(t, runId);
    expect(list.pieces.map((piece) => [piece.key, piece.status])).toEqual([
      ['P1', 'failed'],
      ['P2', 'failed'],
      ['P3', 'skipped'],
    ]);
    expect(list.pieces[2]!.note).toBe(NOT_STARTED_STOPPED);
    const runs = await crewRuns(t, runId);
    expect(runs.filter((run) => run.pieceKey).map((run) => run.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
  });

  it('resumes the cut pieces in their sessions after you continue past the budget', async () => {
    await projectFlags(t, root, { parallel: true });
    const { conversationId, runId } = await begin('#piecebudget', { costCapUsd: 0.1 });
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    expect(asked.map((approval) => approval.kind)).toContain('budget');
    const list = await pieceListOf(t, runId);
    expect(list.pieces.map((piece) => [piece.key, piece.status])).toEqual([
      ['P1', 'landed'],
      ['P2', 'landed'],
      ['P3', 'landed'],
    ]);
    const runs = (await crewRuns(t, runId)).filter((run) => run.pieceKey);
    const keysOf = (key: string) =>
      runs.filter((run) => run.pieceKey === key).map((run) => [run.status, run.resumeKey]);
    expect(keysOf('P1')).toEqual([
      ['cancelled', expect.stringMatching(/:piece:P1$/)],
      ['succeeded', expect.stringMatching(/:piece:P1$/)],
    ]);
    expect(keysOf('P2').map(([status]) => status)).toEqual(['cancelled', 'succeeded']);
    expect(keysOf('P3').map(([status]) => status)).toEqual(['succeeded']);
    expect(runs.find((run) => run.pieceKey === 'P3')!.prompt).not.toContain(
      'Continue where you stopped',
    );
  });
});
