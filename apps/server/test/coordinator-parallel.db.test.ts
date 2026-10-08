import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOT_STARTED_STOPPED } from '../src/coordinator/skip.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { currentPieceList } from '../src/persistence/pieces.ts';
import { requestCancel } from '../src/persistence/runs.ts';
import { taskChanges } from '../src/projects/task-changes.ts';
import { expectConformantRun, storedEvents } from './agui-conformance.ts';
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
    await expectConformantRun(t.db, runId);
    for (const run of runs) {
      expect((await storedEvents(t.db, run.id))[0]).toMatchObject({ parentRunId: runId });
    }
  });

  it('lands two ordered pieces that own the same file', async () => {
    await projectFlags(t, root, { parallel: true });
    const { conversationId, runId } = await begin('#samefile');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const list = await pieceListOf(t, runId);
    expect(list.placement).toBe('shared');
    expect(list.pieces.map((piece) => [piece.key, piece.status, piece.filesChanged])).toEqual([
      ['P1', 'landed', ['strings.ts']],
      ['P2', 'landed', ['strings.ts']],
    ]);
    expect(list.pieces.flatMap((piece) => piece.violations)).toEqual([]);
    expect(await readFile(join(root, 'strings.ts'), 'utf8')).toBe('built by P1\nbuilt by P2\n');
  });

  it.each([
    ['locations, as Claude reports an edit', '#crossedit'],
    ['diff content only, as Codex reports an edit', '#crossdiff'],
  ])(
    'flags a change to the file of a piece running at the same moment and names who made it: %s',
    async (_shape, tag) => {
      await projectFlags(t, root, { parallel: true });
      const { conversationId, runId } = await begin(tag);
      const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
      expect(orchestration.status).toBe('succeeded');
      const list = await pieceListOf(t, runId);
      expect(list.pieces.map((piece) => [piece.key, piece.status])).toEqual([
        ['P1', 'landed'],
        ['P2', 'landed'],
        ['P3', 'landed'],
      ]);
      const runs = await crewRuns(t, runId);
      const first = (key: string) => runs.find((run) => run.pieceKey === key)!;
      expect(overlap(first('P1'), first('P2'))).toBe(true);
      expect(list.pieces[0]!.violations).toEqual([
        { path: 'api.ts', action: 'kept', owner: `${first('P2').name} (P2)` },
      ]);
      expect(list.pieces[1]!.violations).toEqual([]);
      const flags = await t.db.query<{ rail: string; title: string; key: string }>(
        `SELECT f.rail, f.title, r.route->>'pieceKey' AS key FROM rail_flags f
       JOIN runs r ON r.id = f.run_id WHERE r.parent_run_id = $1`,
        [runId],
      );
      expect(flags.rows).toEqual([
        {
          rail: 'other_piece',
          title: `${first('P1').name} changed a file another piece owns: api.ts`,
          key: 'P1',
        },
      ]);
      const audit = await t.db.query<{ run_id: string }>(
        `SELECT l.run_id FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
       WHERE r.parent_run_id = $1 AND l.method = 'spark/rail_crossed'`,
        [runId],
      );
      expect(audit.rows).toEqual([{ run_id: first('P1').id }]);
      const refused = await t.db.query(
        `SELECT 1 FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.parent_run_id = $1 AND a.status = 'denied'`,
        [runId],
      );
      expect(refused.rowCount).toBe(0);
      expect(await readFile(join(root, 'api.ts'), 'utf8')).toContain('crossed by P1');
      const reply = (await assistantReplies(t, runId)).at(-1);
      expect(reply).toContain('`api.ts` kept (P1,');
    },
  );

  it('lets an install follow the agent mode while pieces share the tree', async () => {
    await projectFlags(t, root, { parallel: true });
    const { conversationId, runId } = await begin('#addpkg');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ status: string }>(
      `SELECT a.status FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.parent_run_id = $1 AND a.title = 'pnpm add left-pad'`,
      [runId],
    );
    expect(rows).toEqual([{ status: 'allowed' }]);
  });

  it("leaves a piece's noted check to the mode in Auto and refuses a whole-workspace run", async () => {
    await projectFlags(t, root, { parallel: true });
    const { conversationId, runId } = await begin('#targeted #allnx', {
      agentMode: 'auto',
      routing: 'pinned',
      agentEnv: { FAKE_ACP_MODES: JSON.stringify(CLAUDE_MODES) },
    });
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ title: string; status: string; policy: boolean }>(
      `SELECT a.title, a.status, a.decided_by = 'policy' AS policy FROM approvals a
       JOIN runs r ON r.id = a.run_id
       WHERE r.parent_run_id = $1 AND a.kind = 'execute' ORDER BY a.created_at`,
      [runId],
    );
    expect(rows).toEqual([
      { title: TARGETED_CHECK, status: 'allowed', policy: false },
      { title: 'npx nx run-many --target=test', status: 'denied', policy: true },
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
      placementReason:
        'Jev: 3 pieces · P1 Claude Sonnet 5 · P2 Claude Sonnet 5 · P3 Claude Sonnet 5; this project runs one Builder at a time',
    });
    const runs = await crewRuns(t, runId);
    const first = (key: string) => runs.find((run) => run.pieceKey === key)!;
    expect(overlap(first('P1'), first('P2'))).toBe(false);
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
    await expectConformantRun(t.db, runId);
  });
});
