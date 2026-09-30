import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { liveChatWorktree } from '../src/persistence/chat-worktrees.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { currentPieceList } from '../src/persistence/pieces.ts';
import { taskChanges } from '../src/projects/task-changes.ts';
import { cleanOrphanedCopies } from '../src/orchestration/solo-copy.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import {
  beginPieces,
  crewRuns,
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

async function setUp(workPlace?: 'worktree') {
  t = await createTestDb(workPlace ? { workPlace } : {});
  root = await gitRepo();
  await pieceRepo(root);
  await connectProviders(t);
  await projectFlags(t, root, { parallel: true, stableCheckout: true });
}

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function begin(tags: string, costCapUsd?: number) {
  const begun = beginPieces(t, root, tags, costCapUsd === undefined ? {} : { costCapUsd });
  harness = begun.harness;
  return begun.started;
}

interface Copy {
  runId: string;
  path: string;
  branch: string;
  baseCommit: string;
  mergedAt: Date | null;
  removedAt: Date | null;
}

async function copies(runId: string): Promise<Copy[]> {
  const { rows } = await t.db.query<{
    run_id: string;
    path: string;
    branch: string;
    base_commit: string;
    merged_at: Date | null;
    removed_at: Date | null;
  }>(
    `SELECT run_id, path, branch, base_commit, merged_at, removed_at FROM run_worktrees
     WHERE orchestration_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => ({
    runId: row.run_id,
    path: row.path,
    branch: row.branch,
    baseCommit: row.base_commit,
    mergedAt: row.merged_at,
    removedAt: row.removed_at,
  }));
}

function fileAt(commit: string, file: string): string | null {
  try {
    return execFileSync('git', ['-C', root, 'show', `${commit}:${file}`], { encoding: 'utf8' });
  } catch {
    return null;
  }
}

const read = (file: string) => readFile(join(root, file), 'utf8');

describe('worktree parallel pieces', { timeout: 120_000 }, () => {
  describe('in your checkout', () => {
    beforeEach(() => setUp());

    it('lands each copy as it finishes, merges main into running copies, and cleans up', async () => {
      const { conversationId, runId } = await begin('');
      const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
      expect(orchestration.status).toBe('succeeded');
      const list = await pieceListOf(t, runId);
      expect(list).toMatchObject({
        placement: 'worktree',
        placementReason: 'the project keeps its checkout stable',
      });
      expect(list.pieces.map((piece) => [piece.key, piece.status, piece.filesChanged])).toEqual([
        ['P1', 'landed', ['store.ts']],
        ['P2', 'landed', ['api.ts']],
        ['P3', 'landed', ['view.ts']],
      ]);
      for (const file of ['store.ts', 'api.ts', 'view.ts']) {
        expect(await read(file)).toContain('built by');
      }
      const made = await copies(runId);
      expect(made).toHaveLength(3);
      expect(made.every((copy) => copy.mergedAt && copy.removedAt)).toBe(true);
      expect(made.every((copy) => !existsSync(copy.path))).toBe(true);
      const branches = execFileSync('git', ['-C', root, 'branch', '--list', 'spark/*'], {
        encoding: 'utf8',
      });
      expect(branches.trim()).toBe('');
      const runs = await crewRuns(t, runId);
      const copyOf = (key: string) =>
        made.find((copy) => copy.runId === runs.find((run) => run.pieceKey === key)!.id)!;
      expect(fileAt(copyOf('P2').baseCommit, 'store.ts')).toContain('built by P1');
      expect(fileAt(copyOf('P3').baseCommit, 'store.ts')).toContain('built by P1');
      const changes = await taskChanges(t.db, t.workspaceId, orchestration.taskId!);
      const filesOf = (copy: Copy) =>
        changes.runs.find((run) => run.runId === copy.runId)?.files.map((file) => file.path);
      expect([filesOf(copyOf('P1')), filesOf(copyOf('P2')), filesOf(copyOf('P3'))]).toEqual([
        ['store.ts'],
        ['api.ts'],
        ['view.ts'],
      ]);
      expect(orchestration.crew.find((member) => member.pieceKey === 'P2')?.placement).toBe(
        'worktree',
      );
    });

    it('lets the integrator reconcile a copy that collides with your edits', async () => {
      const { conversationId, runId } = await begin('#useredit');
      const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
      expect(orchestration.status).toBe('succeeded');
      const integrators = (await crewRuns(t, runId)).filter((run) => run.role === 'integrator');
      expect(integrators).toHaveLength(1);
      expect(integrators[0]!.prompt).toContain('could not merge cleanly');
      expect(integrators[0]!.prompt).toContain('### store.ts');
      expect(await read('store.ts')).toBe('user edit\nreconciled\n');
      const reply = (await assistantReplies(t, runId)).at(-1);
      expect(reply).toContain('Merge conflicts: P1 (`store.ts`) resolved by the integrator.');
    });

    it('shows the conflict card when the integrator cannot reconcile it', async () => {
      const keepPiece: Answerer = (approval) =>
        approval.kind === 'merge_conflict'
          ? { optionId: CHECKPOINT_OPTION.keepSecond }
          : answerEverything(approval);
      const { conversationId, runId } = await begin('#useredit #unresolvable');
      const { asked, orchestration } = await driveToEnd(
        t,
        conversationId,
        runId,
        keepPiece,
        90_000,
      );
      expect(orchestration.status).toBe('succeeded');
      const card = asked.find((approval) => approval.kind === 'merge_conflict');
      expect(card?.title).toBe("Bolt's copy and your working tree both changed store.ts.");
      const integrators = (await crewRuns(t, runId)).filter((run) => run.role === 'integrator');
      expect(integrators).toHaveLength(2);
      expect(integrators[1]!.prompt).toContain('Your last attempt did not settle it');
      expect(await read('store.ts')).toBe('built by P1\n');
      const reply = (await assistantReplies(t, runId)).at(-1);
      expect(reply).toContain('Merge conflicts: P1 (`store.ts`) settled by you.');
    });

    it('renumbers a migration whose number an earlier piece took', async () => {
      const { conversationId, runId } = await begin('#migrations');
      const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
      expect(orchestration.status).toBe('succeeded');
      expect((await readdir(join(root, 'migrations'))).sort()).toEqual([
        '0001_init.sql',
        '0002_store.sql',
        '0003_api.sql',
      ]);
      const list = await pieceListOf(t, runId);
      expect(list.pieces[1]!.filesChanged.sort()).toEqual(['api.ts', 'migrations/0003_api.sql']);
      const reply = (await assistantReplies(t, runId)).at(-1);
      expect(reply).toContain(
        'Renumbered migrations: `migrations/0002_api.sql` → `migrations/0003_api.sql` (P2).',
      );
    });

    it('keeps a copy the budget cut so Continue resumes the piece in it', async () => {
      const { conversationId, runId } = await begin('#piecebudget', 0.1);
      const { asked, orchestration } = await driveToEnd(
        t,
        conversationId,
        runId,
        undefined,
        90_000,
      );
      expect(orchestration.status).toBe('succeeded');
      expect(asked.map((approval) => approval.kind)).toContain('budget');
      expect(await copies(runId)).toHaveLength(3);
      const p1 = (await crewRuns(t, runId)).filter((run) => run.pieceKey === 'P1');
      expect(p1.map((run) => run.status)).toEqual(['cancelled', 'succeeded']);
      expect(p1[1]!.worktreeRun).toBe(p1[0]!.id);
      expect(await read('store.ts')).toContain('built by P1');
    });

    it('sweeps the copies a crashed run left behind', async () => {
      const { conversationId, runId } = await begin('#slowpieces');
      const driving = driveToEnd(t, conversationId, runId, undefined, 90_000).catch(() => null);
      const live = await eventually(async () => {
        const taskId = (await loadOrchestration(t.db, runId))?.taskId;
        const list = taskId ? await currentPieceList(t.db, taskId) : null;
        const running = list?.pieces.filter((piece) => piece.status === 'running') ?? [];
        const made = await copies(runId);
        const ready = made.every((copy) => existsSync(join(copy.path, 'piece-check.mjs')));
        return running.length === 2 && made.length === 2 && ready ? made : null;
      }, 60_000);
      const parent = join(root, '.spark', 'worktrees');
      await chmod(parent, 0o555);
      try {
        await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
        await recoverExpiredLeases(t.db);
        await driving;
        await harness!.worker.idle();
      } finally {
        await chmod(parent, 0o755);
      }
      expect(live.every((copy) => existsSync(copy.path))).toBe(true);
      expect((await copies(runId)).map((copy) => copy.removedAt)).toEqual([null, null]);
      expect(await cleanOrphanedCopies(t.db)).toBe(2);
      expect(live.some((copy) => existsSync(copy.path))).toBe(false);
      expect((await copies(runId)).every((copy) => copy.removedAt)).toBe(true);
    });
  });

  describe('in the chat worktree', () => {
    beforeEach(() => setUp('worktree'));

    it('keeps piece copies under the chat worktree and lands them there', async () => {
      const { conversationId, runId } = await begin('');
      const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
      expect(orchestration.status).toBe('succeeded');
      const { rows } = await t.db.query<{ project_id: string }>(
        'SELECT project_id FROM conversation_projects WHERE conversation_id = $1',
        [conversationId],
      );
      const chat = (await liveChatWorktree(t.db, conversationId, rows[0]!.project_id))!;
      const made = await copies(runId);
      expect(made).toHaveLength(3);
      expect(made.every((copy) => copy.path.startsWith(`${chat.path}/.spark/worktrees/`))).toBe(
        true,
      );
      expect(await readFile(join(chat.path, 'store.ts'), 'utf8')).toContain('built by P1');
      expect(existsSync(join(root, 'store.ts'))).toBe(false);
    });
  });
});
