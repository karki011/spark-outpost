import { placeChatOrFailure } from '../orchestration/chat-place.ts';
import type { Handoff } from '../orchestration/spark-child.ts';
import { runChanges } from '../projects/run-changes.ts';
import { takeSnapshot } from '../workflow/do-run.ts';
import { writeKeptRecord } from '../workflow/kept-record-writer.ts';
import { planNote } from '../workflow/plan-recorder.ts';
import { turnOffEdits, type TurnWorkflowRun } from './run-records.ts';

export const EDITS_OFF_NOTE =
  'This workflow may change files, but this chat has no worktree of its own, so its steps only read. Changes are made only in a chat’s own worktree, never in your checkout.';

async function chatCopy(h: Handoff): Promise<string | null> {
  if (h.input.mode !== 'do' || h.input.chatFolder) return null;
  const placed = await placeChatOrFailure(h.deps, h.input, h.append, true, h.lease);
  if ('failed' in placed || placed.input.chatWorktree !== true) return null;
  return placed.input.projectRoots[0] ?? null;
}

export async function prepareStepEdits(
  h: Handoff,
  turn: TurnWorkflowRun,
): Promise<TurnWorkflowRun> {
  if (!turn.edits) return turn;
  const copy = await chatCopy(h);
  if (!copy) {
    await turnOffEdits(h.deps.db, turn.run.id);
    await planNote(h.append, EDITS_OFF_NOTE);
    return { ...turn, edits: false };
  }
  await takeSnapshot(h.deps.db, h.lease.runId, copy);
  return turn;
}

export async function keepStepEdits(h: Handoff, turn: TurnWorkflowRun): Promise<void> {
  if (!turn.edits) return;
  const { db } = h.deps;
  const { workspaceId, level } = h.input;
  const changes = await runChanges(db, workspaceId, h.lease.runId, true).catch(() => null);
  if (!changes || changes.files.length === 0) return;
  await writeKeptRecord(
    { db, append: h.append },
    { runId: h.lease.runId, workspaceId, level },
    changes,
  );
}
