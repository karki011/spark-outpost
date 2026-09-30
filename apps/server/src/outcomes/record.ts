import {
  isTerminalRunStatus,
  runStatusSchema,
  type SaveFeedback,
  type TurnOutcome,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { loadTurn, turnFacts, type TurnRow } from '../persistence/outcome-facts.ts';
import {
  askedInTask,
  decidePrompt,
  ensureOutcomeRow,
  insertSignals,
  keptOf,
  markCommitChecked,
  markSettled,
  outcomeRow,
  outcomeSignals,
  saveFeedback,
  saveKeptContent,
  saveScore,
  toTurnOutcome,
  turnPlace,
  type OutcomeRow,
} from '../persistence/outcomes.ts';
import { repoStillThere, runChanges } from '../projects/run-changes.ts';
import { findKeptCommit, keptContent, type KeptContent } from './commits.ts';
import { deriveSignals, followUpWindowClosed, outcomeKind } from './derive.ts';
import {
  FEEDBACK_SAMPLE_RATE,
  FEEDBACK_TURN_SPACING,
  feedbackPrompt,
  polarityOf,
  scoreOutcome,
} from './signals.ts';

const COMMIT_CHECK_EVERY_MS = 10 * 60 * 1000;
const COMMIT_WATCH_MS = 14 * 24 * 60 * 60 * 1000;

export class OutcomeNotFoundError extends Error {
  constructor() {
    super('That turn was not found.');
  }
}

export class OutcomeNotFinishedError extends Error {
  constructor() {
    super('Feedback opens once the run has finished.');
  }
}

export interface OutcomeOptions {
  now?: Date;
  sampleRate?: number;
  random?: () => number;
  checkCommits?: boolean;
}

type SignalKinds = readonly { kind: string }[];

function committedOrReverted(signals: SignalKinds): boolean {
  return signals.some((signal) => signal.kind === 'committed' || signal.kind === 'reverted');
}

function commitWatchOver(kept: KeptContent, now: Date): boolean {
  return now.getTime() - new Date(kept.at).getTime() > COMMIT_WATCH_MS;
}

function commitDue(row: OutcomeRow, signals: SignalKinds, now: Date): boolean {
  const kept = keptOf(row);
  if (!kept) return false;
  if (committedOrReverted(signals)) return false;
  if (commitWatchOver(kept, now)) return false;
  const checked = row.commit_checked_at?.getTime() ?? 0;
  return now.getTime() - checked >= COMMIT_CHECK_EVERY_MS;
}

async function linkedRoot(db: Queryable, workspaceId: string, root: string): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT 1 FROM projects WHERE workspace_id = $1 AND root_path = $2',
    [workspaceId, root],
  );
  return rows.length > 0;
}

async function checkCommit(db: Queryable, turn: TurnRow, row: OutcomeRow, now: Date) {
  const kept = keptOf(row);
  if (!kept || !(await linkedRoot(db, turn.workspace_id, kept.root))) return;
  await markCommitChecked(db, turn.id, now);
  const found = await findKeptCommit(kept).catch(() => null);
  if (!found) return;
  await insertSignals(db, turn.id, [
    {
      kind: 'committed',
      polarity: polarityOf('committed'),
      source: 'git',
      at: found.at,
      detail: { commit: found.sha, branch: kept.branch },
    },
  ]);
}

function settled(row: OutcomeRow, signals: SignalKinds, now: Date): boolean {
  const kept = keptOf(row);
  if (!kept) return true;
  return committedOrReverted(signals) || commitWatchOver(kept, now);
}

export async function refreshOutcome(
  db: Queryable,
  workspaceId: string,
  runId: string,
  options: OutcomeOptions = {},
): Promise<TurnOutcome | null> {
  const now = options.now ?? new Date();
  const turn = await loadTurn(db, workspaceId, runId);
  if (!turn) throw new OutcomeNotFoundError();
  if (!isTerminalRunStatus(runStatusSchema.parse(turn.status))) return null;
  const facts = await turnFacts(db, turn);
  const kind = outcomeKind(facts);
  await ensureOutcomeRow(db, runId, turn.task_id, kind);
  await insertSignals(db, runId, deriveSignals(facts, now));
  let row = (await outcomeRow(db, runId))!;
  if (options.checkCommits && commitDue(row, await outcomeSignals(db, runId), now)) {
    await checkCommit(db, turn, row, now);
  }
  const signals = await outcomeSignals(db, runId);
  if (!row.prompt_decided_at) {
    const prompt = feedbackPrompt({
      kind,
      succeeded: facts.status === 'succeeded',
      signals,
      askedInTask: await askedInTask(db, runId, turn.task_id),
      ...(await turnPlace(db, runId, FEEDBACK_TURN_SPACING - 1)),
      roll: (options.random ?? Math.random)(),
      sampleRate: options.sampleRate ?? FEEDBACK_SAMPLE_RATE,
    });
    await decidePrompt(db, runId, prompt);
  }
  row = (await outcomeRow(db, runId))!;
  await saveScore(
    db,
    runId,
    scoreOutcome(signals, row.rating === 'up' || row.rating === 'down' ? row.rating : null),
  );
  if (followUpWindowClosed(facts, now) && settled(row, signals, now)) {
    await markSettled(db, runId);
  }
  return toTurnOutcome((await outcomeRow(db, runId))!, signals);
}

export async function recordFeedback(
  db: Queryable,
  workspaceId: string,
  runId: string,
  request: SaveFeedback,
  options: OutcomeOptions = {},
): Promise<TurnOutcome> {
  const before = await refreshOutcome(db, workspaceId, runId, options);
  if (!before) throw new OutcomeNotFinishedError();
  const comment = request.comment?.trim() ? request.comment.trim() : null;
  await saveFeedback(db, runId, {
    rating: request.rating,
    reasons: request.rating === 'down' ? [...new Set(request.reasons)] : [],
    comment,
  });
  const after = await refreshOutcome(db, workspaceId, runId, options);
  return after!;
}

export async function captureKept(db: Queryable, workspaceId: string, runId: string) {
  const turn = await loadTurn(db, workspaceId, runId);
  if (!turn || turn.reverted_at || turn.snapshot_kind !== 'git' || !turn.snapshot_root) return;
  if (turn.status !== 'succeeded') return;
  const changes = await runChanges(db, workspaceId, runId);
  if (changes.revertedAt || changes.files.length === 0) return;
  const root = turn.snapshot_root;
  const kept = await keptContent(root, changes.files, new Date()).catch(async (error: unknown) => {
    if (await repoStillThere(root)) throw error;
    return null;
  });
  if (kept) await saveKeptContent(db, runId, turn.task_id, kept);
}

export async function recordKeptChanges(
  db: Queryable,
  workspaceId: string,
  runId: string,
): Promise<void> {
  await captureKept(db, workspaceId, runId).catch((error: unknown) =>
    console.error(`Could not record the kept changes of run ${runId}`, error),
  );
}
