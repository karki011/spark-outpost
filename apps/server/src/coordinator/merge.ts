import {
  CHECKPOINT_OPTION,
  failingChecks,
  type MergeConflict,
  type TaskPiece,
} from '@spark-outpost/contracts';
import { COORD_INTEGRATOR_TRIES } from '../advisor/policy.ts';
import { saveSnapshot } from '../persistence/run-snapshots.ts';
import { workingTree } from '../projects/snapshot.ts';
import {
  applyTree,
  pinSnapshot,
  takeFileFrom,
  tryMerge,
  type MergeAttempt,
} from '../projects/worktrees.ts';
import { askCard, CheckpointTimeout, mergeConflictCard } from '../orchestration/checkpoint.ts';
import { checkFailureText } from '../orchestration/context.ts';
import { runMember } from '../orchestration/members.ts';
import type { Session } from '../orchestration/session.ts';
import { describeConflict, MAIN_COPY } from '../orchestration/solo-copy.ts';
import { integratorSeat } from './integrator.ts';
import { runPieceChecks } from './piece-run.ts';
import { BUILDER_GIT_RULE } from './prompts.ts';
import type { Conflict, Coordination } from './state.ts';

interface CopyLanding {
  root: string;
  base: string;
  result: string;
  runId: string;
  name: string;
  piece: TaskPiece;
}

const CONFLICT_STOP_NOTE = 'You stopped it at the merge conflict.';
const UNRESOLVED = /^\s*unresolved:/i;
const CONFLICT_ROLE_LINE = `Role: Integrator. A piece's copy could not merge cleanly. ${BUILDER_GIT_RULE}`;

type Attempt = { kind: 'resolved' } | { kind: 'stopped' } | { kind: 'failed'; why: string };

function firstSide(coordination: Coordination, landing: CopyLanding, files: readonly string[]) {
  const earlier = (coordination.list?.pieces ?? []).find(
    (piece) =>
      piece.key !== landing.piece.key &&
      piece.status === 'landed' &&
      piece.filesChanged.some((file) => files.includes(file)),
  );
  if (!earlier) return { name: MAIN_COPY, runId: null };
  return { name: earlier.builderName ?? earlier.key, runId: earlier.builderRunId };
}

function reconcileText(conflict: MergeConflict, failures: string | null): string {
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
    `${conflict.first} and ${conflict.second} changed the same lines. The files now hold ${conflict.first}'s version. Edit them so both changes' intent is kept, then reply with what you did. If you cannot keep both, change nothing and start your reply with "Unresolved:".`,
    ...files,
    ...(failures ? [`## Your last attempt did not settle it\n${failures}`] : []),
  ].join('\n\n');
}

async function integratorTry(
  s: Session,
  coordination: Coordination,
  landing: CopyLanding,
  conflict: MergeConflict,
  failures: string | null,
): Promise<Attempt> {
  const seat = await integratorSeat(s, coordination);
  const { result } = await runMember(
    s,
    {
      role: 'builder',
      reason: 'fix',
      escalate: false,
      note: null,
      followUp: reconcileText(conflict, failures),
    },
    null,
    { seat: { ...seat, prompt: `${CONFLICT_ROLE_LINE}\n\n## Request\n${s.input.userRequest}` } },
  );
  if (result.outcome === 'cancelled' || result.outcome === 'lease_lost') return { kind: 'stopped' };
  if (result.outcome !== 'succeeded') {
    return { kind: 'failed', why: result.error ?? 'the integrator turn failed' };
  }
  if (UNRESOLVED.test(result.text)) return { kind: 'failed', why: result.text.trim() };
  const checks = await runPieceChecks(s, coordination, landing.piece, result, {
    cwd: landing.root,
    copy: null,
    slot: 1,
  });
  if (checks?.status === 'failed') {
    return { kind: 'failed', why: checkFailureText(failingChecks(checks)) };
  }
  return { kind: 'resolved' };
}

async function restoreTree(root: string, tree: string): Promise<void> {
  const current = await workingTree(root);
  if (current !== tree) await applyTree(root, current, tree);
}

function conflictLine(landing: CopyLanding, first: string, files: readonly string[]): string {
  const shown = files.slice(0, 3).join(', ');
  const more = files.length > 3 ? ` and ${files.length - 3} more` : '';
  const other = first === MAIN_COPY ? 'your working tree' : `${first}'s landed piece`;
  return `${landing.name}'s copy and ${other} both changed ${shown}${more}.`;
}

async function askAboutConflict(
  s: Session,
  landing: CopyLanding,
  conflict: MergeConflict,
  attempt: MergeAttempt,
  record: Conflict,
): Promise<string | null> {
  if (s.input.level === 'full-auto') {
    return `${attempt.conflicts.join(', ')} conflicted and the integrator could not reconcile them`;
  }
  const card = mergeConflictCard(
    conflict,
    conflictLine(landing, conflict.first, attempt.conflicts),
  );
  const answer = await askCard(s, card);
  if (answer.type === 'timeout') throw new CheckpointTimeout();
  if (answer.type === 'stopped' || answer.optionId === CHECKPOINT_OPTION.stop) {
    return CONFLICT_STOP_NOTE;
  }
  if (answer.optionId === CHECKPOINT_OPTION.keepSecond) {
    for (const file of attempt.conflicts) await takeFileFrom(landing.root, landing.result, file);
  }
  record.resolvedBy = 'you';
  return null;
}

async function resolve(
  s: Session,
  coordination: Coordination,
  landing: CopyLanding,
  attempt: MergeAttempt,
): Promise<string | null> {
  const { root, base } = landing;
  const first = firstSide(coordination, landing, attempt.conflicts);
  const second = { name: landing.name, runId: landing.runId, result: landing.result };
  const conflict = await describeConflict(root, { first, second }, attempt, base);
  const record: Conflict = {
    piece: landing.piece.key,
    files: attempt.conflicts,
    resolvedBy: null,
  };
  coordination.conflicts = [...(coordination.conflicts ?? []), record];
  await applyTree(root, attempt.current, attempt.tree, attempt.conflicts);
  const before = await workingTree(root);
  let failures: string | null = null;
  for (let tries = 0; tries < COORD_INTEGRATOR_TRIES; tries += 1) {
    const tried = await integratorTry(s, coordination, landing, conflict, failures);
    if (tried.kind === 'stopped') return CONFLICT_STOP_NOTE;
    if (tried.kind === 'resolved') {
      record.resolvedBy = 'integrator';
      return null;
    }
    failures = tried.why;
  }
  await restoreTree(root, before);
  return askAboutConflict(s, landing, conflict, attempt, record);
}

export async function mergeIntoMain(
  s: Session,
  coordination: Coordination,
  landing: CopyLanding,
): Promise<string | null> {
  const { root, base, result, runId } = landing;
  const attempt = await tryMerge(root, base, result);
  await pinSnapshot(root, runId, attempt.current);
  await saveSnapshot(s.deps.db, runId, { kind: 'git', ref: attempt.current, root });
  if (attempt.conflicts.length === 0) {
    await applyTree(root, attempt.current, attempt.tree);
    return null;
  }
  return resolve(s, coordination, landing, attempt);
}
