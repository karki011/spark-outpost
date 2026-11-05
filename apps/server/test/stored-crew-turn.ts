import { randomUUID } from 'node:crypto';
import type { Db } from '../src/persistence/db.ts';

export interface StoredPiece {
  key: string;
  title: string;
  owns: string[];
  provider: string;
  model: string;
  status?: string;
  builderRunId?: string | null;
  pickNote?: string | null;
}

export interface StoredPieceList {
  taskId: string;
  orchestrationRunId: string;
  placementReason: string;
  pieces: readonly StoredPiece[];
}

export async function storePieceList(db: Db, list: StoredPieceList): Promise<void> {
  const listId = randomUUID();
  await db.query(
    `INSERT INTO piece_lists (id, task_id, orchestration_run_id, version, pieces_hash, placement,
       placement_reason, status, approved_by)
     VALUES ($1, $2, $3, 1, 'hash', 'shared', $4, 'approved', 'level')`,
    [listId, list.taskId, list.orchestrationRunId, list.placementReason],
  );
  for (const [position, piece] of list.pieces.entries()) {
    await db.query(
      `INSERT INTO task_pieces (id, piece_list_id, position, key, title, goal, owns, reads,
         depends_on, contract, acceptance, checks, research, size_estimate, placement, provider,
         model, pick_note, status, builder_run_id)
       VALUES ($1, $2, $3, $4, $5, $5, $6, '{}', '{}', NULL, '{}', '{}', false, 1000, 'shared',
         $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        listId,
        position,
        piece.key,
        piece.title,
        piece.owns,
        piece.provider,
        piece.model,
        piece.pickNote ?? null,
        piece.status ?? 'pending',
        piece.builderRunId ?? null,
      ],
    );
  }
}

export interface StoredHelper {
  role: string;
  name: string;
  provider: string;
  model: string;
  status: string;
  costUsd: number;
  reply: string | null;
  route?: Record<string, unknown>;
}

export async function storeHelper(
  db: Db,
  parentRunId: string,
  helper: StoredHelper,
): Promise<string> {
  const runId = randomUUID();
  await db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, model, status, task_id,
       parent_run_id, role, step_index, attempt, route, cost_usd, mode)
     SELECT $1, p.conversation_id, p.user_message_id, $3, $4, $5, p.task_id, p.id, $6, 1, 1, $7,
       $8, 'do'
     FROM runs p WHERE p.id = $2`,
    [
      runId,
      parentRunId,
      helper.provider,
      helper.model,
      helper.status,
      helper.role,
      JSON.stringify({ name: helper.name, ...helper.route }),
      helper.costUsd,
    ],
  );
  if (helper.reply !== null) await storeReply(db, runId, helper.reply);
  return runId;
}

export async function storeReply(db: Db, runId: string, content: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     SELECT $1, conversation_id, 'assistant', $2, id FROM runs WHERE id = $3`,
    [id, content, runId],
  );
  return id;
}
