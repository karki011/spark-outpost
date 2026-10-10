import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimNextJob } from '../src/persistence/jobs.ts';
import {
  insertChildRun,
  insertOrchestration,
  loadOrchestration,
} from '../src/persistence/orchestrations.ts';
import { currentPieceList, insertPieceList, type NewPiece } from '../src/persistence/pieces.ts';
import { getRun } from '../src/persistence/runs.ts';
import { taskForWorkingRun } from '../src/persistence/tasks.ts';
import {
  OUTCOME_UNKNOWN_MESSAGE,
  PIECE_NOT_STARTED,
  PIECE_OUTCOME_UNKNOWN,
} from '../src/workflow/recovery.ts';
import { runAppender } from '../src/workflow/run-appender.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { expireLeases, untilStatus } from './interruption-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import {
  driveToEnd,
  gitRepo,
  openChat,
  removeRepo,
  repliesOf,
  sendMessage,
} from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

const BUILD = 'Move date handling into one module. #build';

let t: TestDb;
let root: string;
let worker: Worker | null = null;

beforeEach(async () => {
  t = await createTestDb({ workPlace: 'worktree' });
  root = await gitRepo();
  await connectAgents(t);
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
  await removeRepo(root);
});

function piece(key: string, file: string): NewPiece {
  return {
    key,
    title: `Piece ${key}`,
    goal: `Change ${file}`,
    owns: [file],
    reads: [],
    dependsOn: [],
    contract: null,
    acceptance: [],
    checks: [],
    research: false,
    sizeEstimate: 1_000,
    placement: 'shared',
    provider: 'claude',
    model: 'sonnet',
  };
}

async function crewTurnMidBuild(conversationId: string) {
  const runId = await sendMessage(t, conversationId, BUILD, { permission: 'do' });
  const lease = (await claimNextJob(t.db, 30))!;
  const identity = { runId, threadId: conversationId };
  await runAppender(t.db, lease)(runEvents.started(identity), {
    transition: { status: 'running' },
  });
  await insertOrchestration(t.db, {
    runId,
    depth: 'execute',
    depthSource: 'rules',
    risk: 'edits',
    routing: 'auto',
  });
  const builder = await insertChildRun(
    t.db,
    {
      parentRunId: runId,
      role: 'builder',
      stepIndex: 0,
      attempt: 1,
      agentLabel: 'Bolt',
      provider: 'claude',
      model: 'sonnet',
      effort: null,
      route: { name: 'Bolt' },
      mode: 'do',
      prompt: 'Build P1.',
    },
    30,
  );
  const { task } = await taskForWorkingRun(t.db, runId, BUILD);
  const list = await insertPieceList(t.db, {
    taskId: task.taskId,
    orchestrationRunId: runId,
    planDocumentId: null,
    planVersion: null,
    piecesHash: 'hash',
    placement: 'shared',
    placementReason: 'pieces share one tree',
    integration: null,
    approvedBy: 'level',
    pieces: [piece('P1', 'src/dates.ts'), piece('P2', 'src/divider.ts')],
  });
  await t.db.query(`UPDATE task_pieces SET status = 'running', builder_run_id = $2 WHERE id = $1`, [
    list.pieces[0]!.id,
    builder.runId,
  ]);
  return { runId, builderRunId: builder.runId, taskId: task.taskId };
}

describe(
  'a chat that was mid-turn in a crew turn when the app updated',
  { timeout: 60_000 },
  () => {
    it('ends the turn and its Builder as outcome unknown, marks its pieces, and runs the next message directly', async () => {
      const conversationId = await openChat(t, { root, level: 'hands-off' });
      const old = await crewTurnMidBuild(conversationId);
      await expireLeases(t, old.runId);

      worker = startTurnWorker(t);
      const before = await untilStatus(t, old.runId, 'outcome_unknown');
      await untilStatus(t, old.builderRunId, 'outcome_unknown');

      expect(before.error).toBe(OUTCOME_UNKNOWN_MESSAGE);
      const stored = await currentPieceList(t.db, old.taskId);
      expect(stored!.pieces.map((entry) => [entry.key, entry.status, entry.note])).toEqual([
        ['P1', 'failed', PIECE_OUTCOME_UNKNOWN],
        ['P2', 'skipped', PIECE_NOT_STARTED],
      ]);
      expect(await loadOrchestration(t.db, old.runId)).not.toBeNull();

      const runId = await sendMessage(t, conversationId, 'Are you there?', { permission: 'do' });
      const { run } = await driveToEnd(t, conversationId, runId);

      expect(run).toMatchObject({ status: 'succeeded', role: null });
      expect(await repliesOf(t, runId)).toHaveLength(1);
      expect(await loadOrchestration(t.db, runId)).toBeNull();
      const children = await t.db.query('SELECT 1 FROM runs WHERE parent_run_id = $1', [runId]);
      expect(children.rowCount).toBe(0);
      expect((await getRun(t.db, old.runId))?.status).toBe('outcome_unknown');
    });
  },
);
