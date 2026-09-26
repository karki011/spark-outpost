import {
  CHECKPOINT_OPTION,
  CONFLICT_TEXT_MAX_BYTES,
  type MergeConflict,
} from '@spark-outpost/contracts';
import { saveSnapshot } from '../persistence/run-snapshots.ts';
import { markMerged, type WorktreeRecord } from '../persistence/worktrees.ts';
import { gitChanges, gitFileAt } from '../projects/snapshot.ts';
import {
  applyTree,
  fileDiff,
  pinSnapshot,
  takeFileFrom,
  tryMerge,
  type MergeAttempt,
} from '../projects/worktrees.ts';
import { askCard, CheckpointTimeout, mergeConflictCard } from './checkpoint.ts';
import { runMember } from './members.ts';
import { conflictLine } from './parallel.ts';
import { markPlanStep } from './plan-progress.ts';
import type { Session } from './session.ts';
import type { AgentOutcome } from './transitions.ts';

export interface Finished {
  stepIndex: number;
  runId: string;
  name: string;
  record: WorktreeRecord & { resultCommit: string };
}

export interface MergeOutcome {
  results: Map<number, AgentOutcome>;
  stopped: boolean;
}

interface Merged {
  name: string;
  runId: string;
  files: Set<string>;
}

function firstOwner(merged: readonly Merged[], files: readonly string[]): Merged | null {
  return merged.find((earlier) => files.some((file) => earlier.files.has(file))) ?? null;
}

async function textAt(root: string, commit: string, file: string): Promise<string | null> {
  const content = await gitFileAt(root, commit, file);
  if (!content || content.length > CONFLICT_TEXT_MAX_BYTES || content.includes(0)) return null;
  return content.toString('utf8');
}

async function describeConflict(
  root: string,
  copy: Finished,
  attempt: MergeAttempt,
  owner: Merged | null,
): Promise<MergeConflict> {
  const first = owner?.name ?? 'The main copy';
  const base = copy.record.baseCommit;
  const files = await Promise.all(
    attempt.conflicts.map(async (path) => ({
      path,
      base: await textAt(root, base, path),
      first: {
        name: first,
        runId: owner?.runId ?? null,
        diff: await fileDiff(root, base, attempt.current, path),
        text: await textAt(root, attempt.current, path),
      },
      second: {
        name: copy.name,
        runId: copy.runId,
        diff: await fileDiff(root, base, copy.record.resultCommit, path),
        text: await textAt(root, copy.record.resultCommit, path),
      },
    })),
  );
  return { first, second: copy.name, files };
}

function reconcileText(conflict: MergeConflict): string {
  const files = conflict.files.map((file) =>
    [
      `### ${file.path}`,
      `${file.first.name}'s change (already in the files):`,
      '```diff',
      file.first.diff.trim(),
      '```',
      `${file.second.name}'s change (not applied yet):`,
      '```diff',
      file.second.diff.trim(),
      '```',
    ].join('\n'),
  );
  return [
    `${conflict.first} and ${conflict.second} changed the same lines in parallel copies. The files now hold ${conflict.first}'s version. Edit them so both changes' intent is kept, then reply with what you did.`,
    ...files,
  ].join('\n\n');
}

async function reconcile(s: Session, copy: Finished, conflict: MergeConflict) {
  const { result } = await runMember(
    s,
    {
      role: 'builder',
      stepIndex: copy.stepIndex,
      escalate: false,
      note: null,
      reason: 'fix',
      conflict: reconcileText(conflict),
    },
    { key: `builder:reconcile:${copy.stepIndex}` },
  );
  if (result.outcome === 'lease_lost') return 'cancelled' as const;
  return result.outcome;
}

async function settle(
  s: Session,
  copy: Finished,
  attempt: MergeAttempt,
  owner: Merged | null,
): Promise<AgentOutcome | 'stopped'> {
  const root = copy.record.repoRoot;
  const conflict = await describeConflict(root, copy, attempt, owner);
  const reason = conflictLine(conflict.first, conflict.second, attempt.conflicts);
  const answer = await askCard(s, mergeConflictCard(conflict, reason));
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  if (answer.type === 'stopped' || answer.optionId === CHECKPOINT_OPTION.stop) return 'stopped';
  await applyTree(root, attempt.current, attempt.tree, attempt.conflicts);
  if (answer.optionId === CHECKPOINT_OPTION.keepSecond) {
    for (const file of attempt.conflicts) await takeFileFrom(root, copy.record.resultCommit, file);
  }
  if (answer.optionId === CHECKPOINT_OPTION.reconcile) return reconcile(s, copy, conflict);
  return 'succeeded';
}

export async function mergeCopies(s: Session, copies: readonly Finished[]): Promise<MergeOutcome> {
  const results = new Map<number, AgentOutcome>();
  const merged: Merged[] = [];
  const ordered = [...copies].sort((a, b) => a.stepIndex - b.stepIndex);
  for (const copy of ordered) {
    const { repoRoot: root, baseCommit, resultCommit } = copy.record;
    const attempt = await tryMerge(root, baseCommit, resultCommit);
    await pinSnapshot(root, copy.runId, attempt.current);
    await saveSnapshot(s.deps.db, copy.runId, { kind: 'git', ref: attempt.current, root });
    let outcome: AgentOutcome | 'stopped' = 'succeeded';
    if (attempt.conflicts.length === 0) {
      await applyTree(root, attempt.current, attempt.tree);
    } else {
      outcome = await settle(s, copy, attempt, firstOwner(merged, attempt.conflicts));
    }
    if (outcome === 'stopped') return { results, stopped: true };
    await markMerged(s.deps.db, copy.runId);
    results.set(copy.stepIndex, outcome);
    if (outcome === 'succeeded') {
      await markPlanStep(s, copy.stepIndex, 'completed', copy.runId);
    }
    const changed = await gitChanges(root, baseCommit, resultCommit);
    merged.push({
      name: copy.name,
      runId: copy.runId,
      files: new Set(changed.map((c) => c.path)),
    });
  }
  return { results, stopped: false };
}
