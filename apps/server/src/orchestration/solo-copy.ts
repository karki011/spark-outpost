import path from 'node:path';
import {
  CHECKPOINT_OPTION,
  CONFLICT_TEXT_MAX_BYTES,
  type MergeConflict,
} from '@spark-outpost/contracts';
import { modeNeedsWorktree } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { saveSnapshot } from '../persistence/run-snapshots.ts';
import {
  getWorktree,
  insertWorktree,
  liveWorktrees,
  markMerged,
  markRemoved,
  orphanedWorktrees,
  saveResult,
  type WorktreeRecord,
} from '../persistence/worktrees.ts';
import { settleDepsPrep, startDepsPrep } from '../projects/deps-prep.ts';
import { commitTree, gitFileAt } from '../projects/snapshot.ts';
import {
  addWorktree,
  applyTree,
  branchName,
  commitWorktree,
  excludeSparkDir,
  fileDiff,
  groupBase,
  pinSnapshot,
  removeWorktree,
  repoTop,
  takeFileFrom,
  tryMerge,
  worktreePath,
  type MergeAttempt,
} from '../projects/worktrees.ts';
import { askCard, CheckpointTimeout, mergeConflictCard } from './checkpoint.ts';
import { copiesRiskyWork } from './checkpoint-policy.ts';
import { checkAndFix } from './land.ts';
import { ensureParentSnapshot, runMember, type MemberOutcome, type Place } from './members.ts';
import type { Session } from './session.ts';
import type { FlowAction } from './transitions.ts';

type BuilderSpawn = Extract<FlowAction, { type: 'spawn' }>;

const MAIN_COPY = 'your version';

export async function repoBusy(db: Db, runId: string, root: string): Promise<boolean> {
  const { rows } = await db.query<{ busy: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM runs r
       JOIN conversation_projects cp ON cp.conversation_id = r.conversation_id AND cp.position = 0
       JOIN projects p ON p.id = cp.project_id
       WHERE r.id <> $1 AND r.parent_run_id IS NULL AND r.mode = 'do'
         AND r.status IN ('running', 'awaiting_approval') AND p.root_path = $2
         AND NOT EXISTS (
           SELECT 1 FROM chat_worktrees cw
           WHERE cw.conversation_id = r.conversation_id AND cw.project_id = p.id
             AND cw.removed_at IS NULL AND NOT cw.in_place)
     ) AS busy`,
    [runId, root],
  );
  return rows[0]?.busy ?? false;
}

export interface CopyFacts {
  provider: string;
  agentMode: string | null;
  level: Session['input']['level'];
  destructive: boolean;
  risky: boolean;
  busy: boolean;
}

export function needsCopyFor(facts: CopyFacts): boolean {
  return (
    facts.level === 'full-auto' ||
    modeNeedsWorktree(facts.provider, facts.agentMode) ||
    facts.destructive ||
    (facts.risky && copiesRiskyWork(facts.level)) ||
    facts.busy
  );
}

interface Copies {
  root: string;
  top: string;
  base: string;
}

async function prepareCopies(s: Session): Promise<Copies> {
  const root = s.input.projectRoots[0]!;
  await ensureParentSnapshot(s);
  await excludeSparkDir(root);
  const [top, base] = await Promise.all([repoTop(root), groupBase(root, `${s.lease.runId} solo`)]);
  return { root, top, base };
}

function copyFor(s: Session, copies: Copies): NonNullable<Place['copy']> {
  return (name) => {
    const branch = branchName(s.taskId, name, s.deps.branchPrefix);
    return {
      branch,
      prepare: async (runId) => {
        const target = worktreePath(copies.root, runId);
        const project = path.join(target, path.relative(copies.top, copies.root));
        await insertWorktree(s.deps.db, {
          runId,
          orchestrationRunId: s.lease.runId,
          repoRoot: copies.root,
          path: project,
          branch,
          baseCommit: copies.base,
        });
        await addWorktree(copies.root, target, branch, copies.base);
        startDepsPrep(s.deps.db, runId, copies.root, project, {
          root: copies.root,
          signal: s.control.signal,
        });
      },
    };
  };
}

export async function placeFor(s: Session): Promise<Place> {
  if (s.copyRunId) {
    const record = await getWorktree(s.deps.db, s.copyRunId);
    if (record) return { reuse: { runId: record.runId, branch: record.branch } };
  }
  return { copy: copyFor(s, await prepareCopies(s)) };
}

async function textAt(root: string, commit: string, file: string): Promise<string | null> {
  const content = await gitFileAt(root, commit, file);
  if (!content || content.length > CONFLICT_TEXT_MAX_BYTES || content.includes(0)) return null;
  return content.toString('utf8');
}

async function describeConflict(
  record: WorktreeRecord & { resultCommit: string },
  name: string,
  attempt: MergeAttempt,
  base: string,
): Promise<MergeConflict> {
  const root = record.repoRoot;
  const files = await Promise.all(
    attempt.conflicts.map(async (file) => ({
      path: file,
      base: await textAt(root, base, file),
      first: {
        name: MAIN_COPY,
        runId: null,
        diff: await fileDiff(root, base, attempt.current, file),
        text: await textAt(root, attempt.current, file),
      },
      second: {
        name,
        runId: record.runId,
        diff: await fileDiff(root, base, record.resultCommit, file),
        text: await textAt(root, record.resultCommit, file),
      },
    })),
  );
  return { first: MAIN_COPY, second: name, files };
}

function conflictLine(name: string, files: readonly string[]): string {
  const shown = files.slice(0, 3).join(', ');
  const more = files.length > 3 ? ` and ${files.length - 3} more` : '';
  return `${name}'s copy and your working tree both changed ${shown}${more}.`;
}

export async function mergeCopy(s: Session, name: string): Promise<'merged' | 'stopped'> {
  const record = s.copyRunId ? await getWorktree(s.deps.db, s.copyRunId) : null;
  if (!record) return 'merged';
  const target = worktreePath(record.repoRoot, record.runId);
  const base = s.copyMerged ?? record.baseCommit;
  const resultCommit = await commitWorktree(
    record.repoRoot,
    target,
    record.branch,
    base,
    record.runId,
  );
  await saveResult(s.deps.db, record.runId, resultCommit);
  const root = record.repoRoot;
  const attempt = await tryMerge(root, base, resultCommit);
  await pinSnapshot(root, record.runId, attempt.current);
  await saveSnapshot(s.deps.db, record.runId, { kind: 'git', ref: attempt.current, root });
  if (attempt.conflicts.length > 0) {
    const conflict = await describeConflict({ ...record, resultCommit }, name, attempt, base);
    const answer = await askCard(
      s,
      mergeConflictCard(conflict, conflictLine(name, attempt.conflicts)),
    );
    if (answer.type === 'timeout') throw new CheckpointTimeout();
    if (answer.type === 'stopped' || answer.optionId === CHECKPOINT_OPTION.stop) return 'stopped';
    await applyTree(root, attempt.current, attempt.tree, attempt.conflicts);
    if (answer.optionId === CHECKPOINT_OPTION.keepSecond) {
      for (const file of attempt.conflicts) await takeFileFrom(root, resultCommit, file);
    }
  } else {
    await applyTree(root, attempt.current, attempt.tree);
  }
  await markMerged(s.deps.db, record.runId);
  s.copyMerged = resultCommit;
  return 'merged';
}

export async function buildInCopy(s: Session, action: BuilderSpawn): Promise<MemberOutcome> {
  const place = await placeFor(s);
  const outcome = await runMember(s, action, place);
  const first = outcome.result;
  s.copyRunId ??= place.reuse?.runId ?? first.runId;
  if (first.outcome !== 'succeeded' || s.budgetHit) return outcome;
  const record = await getWorktree(s.deps.db, s.copyRunId);
  if (!record) return outcome;
  const landed = await checkAndFix(s, first, {
    cwd: record.path,
    before: await commitTree(record.repoRoot, record.baseCommit),
    place: { reuse: { runId: record.runId, branch: record.branch } },
  });
  if (landed.result.outcome !== 'succeeded') return { ...outcome, result: landed.result };
  const merged = await mergeCopy(s, first.name);
  return {
    ...outcome,
    result: { ...landed.result, outcome: merged === 'stopped' ? 'cancelled' : 'succeeded' },
  };
}

async function removeCopy(db: Db, record: WorktreeRecord): Promise<void> {
  await settleDepsPrep(record.runId);
  await removeWorktree(record.repoRoot, worktreePath(record.repoRoot, record.runId), record.branch);
  await markRemoved(db, record.runId);
}

async function removeAll(db: Db, records: readonly WorktreeRecord[]): Promise<number> {
  let removed = 0;
  for (const record of records) {
    try {
      await removeCopy(db, record);
      removed += 1;
    } catch (error) {
      console.error(`Could not remove the worktree for run ${record.runId}`, error);
    }
  }
  return removed;
}

export async function cleanupCopies(s: Session): Promise<void> {
  await removeAll(s.deps.db, await liveWorktrees(s.deps.db, s.lease.runId));
}

export async function cleanOrphanedCopies(db: Db): Promise<number> {
  return removeAll(db, await orphanedWorktrees(db));
}
