import {
  CHECKPOINT_OPTION,
  type CheckpointPayload,
  type InvolvementLevel,
  type RunChange,
  type RunChanges,
} from '@spark-outpost/contracts';
import { insertApproval } from '../persistence/approvals.ts';
import type { Queryable } from '../persistence/db.ts';
import { getSnapshot } from '../persistence/run-snapshots.ts';
import { changedFiles, currentBranch } from '../projects/chat-worktrees.ts';
import { liveRunBase } from '../projects/run-base.ts';
import { gitDiffSince, headCommit, type FileStat } from '../projects/snapshot.ts';
import type { Append } from './agent-turn.ts';
import {
  acceptCard,
  checkpointApproval,
  type ChangedLines,
  type CheckpointCard,
} from './kept-record.ts';
import { runEvents } from './run-events.ts';

export const KEPT_RECORD_TITLE = 'Changes kept';

const KEPT_RECORD_SEQUENCE = 1;
const SHORT_COMMIT = 7;

export type KeptAt = CheckpointPayload['keptAt'];

export interface KeptFacts {
  files: readonly RunChange[];
  level: InvolvementLevel;
  lines: ChangedLines;
  keptAt: KeptAt;
}

export interface KeptRecordDeps {
  db: Queryable;
  append: Append;
}

export interface KeptRun {
  runId: string;
  workspaceId: string;
  level: InvolvementLevel;
}

export function keptCard(facts: KeptFacts): CheckpointCard {
  const plain = acceptCard(facts.files, '', null, [], facts.lines);
  return {
    ...plain,
    title: KEPT_RECORD_TITLE,
    payload: { ...plain.payload, keptBy: facts.level, keptAt: facts.keptAt },
  };
}

export function lineTotals(stats: readonly FileStat[]): ChangedLines {
  if (stats.length === 0) return null;
  return {
    added: stats.reduce((sum, file) => sum + file.additions, 0),
    removed: stats.reduce((sum, file) => sum + file.deletions, 0),
  };
}

async function linesSince(root: string, ref: string): Promise<ChangedLines> {
  const diff = await gitDiffSince(root, await liveRunBase(root, ref)).catch(() => null);
  return diff ? lineTotals(diff.stats) : null;
}

async function keptAtIn(root: string): Promise<KeptAt> {
  const [branch, head, uncommitted] = await Promise.all([
    currentBranch(root),
    headCommit(root),
    changedFiles(root).catch(() => null),
  ]);
  const committed = head !== null && uncommitted !== null && uncommitted.length === 0;
  return { branch, commit: committed ? head.slice(0, SHORT_COMMIT) : null };
}

async function whereKept(
  db: Queryable,
  run: KeptRun,
): Promise<Pick<KeptFacts, 'lines' | 'keptAt'>> {
  const state = await getSnapshot(db, run.workspaceId, run.runId);
  const snapshot = state?.snapshot;
  if (!snapshot || snapshot.kind !== 'git' || !snapshot.ref) return { lines: null, keptAt: null };
  const [lines, keptAt] = await Promise.all([
    linesSince(snapshot.root, snapshot.ref),
    keptAtIn(snapshot.root).catch(() => null),
  ]);
  return { lines, keptAt };
}

export async function writeKeptRecord(
  deps: KeptRecordDeps,
  run: KeptRun,
  changes: Pick<RunChanges, 'files'>,
): Promise<void> {
  if (changes.files.length === 0) return;
  const where = await whereKept(deps.db, run);
  const card = keptCard({ files: changes.files, level: run.level, ...where });
  const kept = await insertApproval(
    deps.db,
    checkpointApproval(run.runId, card, KEPT_RECORD_SEQUENCE),
    { status: 'allowed', decidedBy: 'level', optionId: CHECKPOINT_OPTION.keep },
  );
  await deps.append(runEvents.approvalRequested(kept));
  await deps.append(runEvents.approvalDecided(kept));
}
