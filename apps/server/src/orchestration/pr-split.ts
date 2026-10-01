import { CHECKPOINT_OPTION, type TaskPiece } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { askCard, prSplitCard } from './checkpoint.ts';
import type { Session } from './session.ts';

export type PrSplit = 'one' | 'separate';

const ANSWERS: Record<string, { split: PrSplit; remember: boolean }> = {
  [CHECKPOINT_OPTION.onePr]: { split: 'one', remember: false },
  [CHECKPOINT_OPTION.separatePrs]: { split: 'separate', remember: false },
  [CHECKPOINT_OPTION.alwaysOnePr]: { split: 'one', remember: true },
  [CHECKPOINT_OPTION.alwaysSeparatePrs]: { split: 'separate', remember: true },
};

export function ownWorktreePieces(s: Pick<Session, 'coordination'>): TaskPiece[] {
  return (s.coordination?.list?.pieces ?? []).filter(
    (piece) =>
      piece.placement === 'worktree' && piece.status === 'landed' && piece.filesChanged.length > 0,
  );
}

const PROJECT_OF_RUN = `SELECT cp.project_id FROM runs r
  JOIN conversation_projects cp ON cp.conversation_id = r.conversation_id
  WHERE r.id = $1 ORDER BY cp.position, cp.created_at LIMIT 1`;

async function rememberedSplit(db: Queryable, runId: string): Promise<PrSplit | null> {
  const { rows } = await db.query<{ pr_split: PrSplit | null }>(
    `SELECT p.pr_split FROM projects p WHERE p.id = (${PROJECT_OF_RUN})`,
    [runId],
  );
  return rows[0]?.pr_split ?? null;
}

async function rememberSplit(db: Queryable, runId: string, split: PrSplit): Promise<void> {
  await db.query(`UPDATE projects SET pr_split = $2 WHERE id = (${PROJECT_OF_RUN})`, [
    runId,
    split,
  ]);
}

export async function choosePrSplit(
  s: Session,
  pieces: readonly TaskPiece[],
): Promise<PrSplit | null> {
  const remembered = await rememberedSplit(s.deps.db, s.lease.runId);
  if (remembered) return remembered;
  const answer = await askCard(s, prSplitCard(pieces.map((piece) => piece.key)));
  if (answer.type === 'stopped') return null;
  const chosen = answer.type === 'answered' ? ANSWERS[answer.optionId] : undefined;
  if (!chosen) return 'one';
  if (chosen.remember) await rememberSplit(s.deps.db, s.lease.runId, chosen.split);
  return chosen.split;
}
