import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
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
} from './coordinator-support.ts';
import {
  answerEverything,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  removeRepo,
  type Answerer,
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
  });

  it('keeps pieces in order while the project has parallel pieces off', async () => {
    await projectFlags(t, root, { parallel: false });
    const { conversationId, runId } = await begin('');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const list = await pieceListOf(t, runId);
    expect(list).toMatchObject({
      placement: 'in_order',
      placementReason: 'parallel pieces are off for this project',
    });
    const runs = await crewRuns(t, runId);
    const first = (key: string) => runs.find((run) => run.pieceKey === key)!;
    expect(overlap(first('P1'), first('P2'))).toBe(false);
  });

  it('asks at Review each step before building in parallel and builds in order when told to', async () => {
    await projectFlags(t, root, { parallel: true });
    const inOrder: Answerer = (approval) =>
      approval.kind === 'pieces'
        ? { optionId: CHECKPOINT_OPTION.buildInOrder }
        : answerEverything(approval);
    const { conversationId, runId } = await begin('', { level: 'balanced' });
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, inOrder, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const card = asked.find((approval) => approval.kind === 'pieces');
    expect(card?.title).toBe('Build in 3 pieces, 2 at once in the shared tree?');
    expect(card?.options.map((option) => option.name)).toEqual([
      'Build it',
      'Build in order instead',
      'Revise',
      'Stop',
    ]);
    const list = await pieceListOf(t, runId);
    expect(list).toMatchObject({
      placement: 'in_order',
      placementReason: 'you chose to build in order',
      status: 'approved',
    });
    expect(list.pieces.map((piece) => [piece.placement, piece.status])).toEqual([
      ['in_order', 'landed'],
      ['in_order', 'landed'],
      ['in_order', 'landed'],
    ]);
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
      ['P3', 'pending'],
    ]);
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
