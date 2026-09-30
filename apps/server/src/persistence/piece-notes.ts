import type { PieceNoteKind } from '@spark-outpost/contracts';
import type { Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface NewNote {
  kind: PieceNoteKind;
  body: string;
  source: 'user' | 'coordinator';
  urgent: boolean;
}

export interface StoredNote extends NewNote {
  id: string;
  pieceId: string | null;
}

interface NoteRow {
  id: string;
  piece_id: string | null;
  kind: PieceNoteKind;
  body: string;
  source: 'user' | 'coordinator';
  urgent: boolean;
}

function toNote(row: NoteRow): StoredNote {
  return {
    id: row.id,
    pieceId: row.piece_id,
    kind: row.kind,
    body: row.body,
    source: row.source,
    urgent: row.urgent,
  };
}

export async function insertPieceNote(
  db: Queryable,
  target: { pieceId: string } | { listId: string },
  note: NewNote,
): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO piece_notes (id, piece_id, piece_list_id, kind, body, source, urgent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      'pieceId' in target ? target.pieceId : null,
      'listId' in target ? target.listId : null,
      note.kind,
      note.body,
      note.source,
      note.urgent,
    ],
  );
  return id;
}

export async function pendingPieceNotes(db: Queryable, pieceId: string): Promise<StoredNote[]> {
  const { rows } = await db.query<NoteRow>(
    `SELECT * FROM piece_notes WHERE piece_id = $1 AND delivered_at IS NULL
     ORDER BY created_at, id`,
    [pieceId],
  );
  return rows.map(toNote);
}

export async function pendingListNotes(db: Queryable, listId: string): Promise<StoredNote[]> {
  const { rows } = await db.query<NoteRow>(
    `SELECT * FROM piece_notes WHERE piece_list_id = $1 AND delivered_at IS NULL
     ORDER BY created_at, id`,
    [listId],
  );
  return rows.map(toNote);
}

export async function markNotesDelivered(
  db: Queryable,
  noteIds: readonly string[],
  runId: string | null,
): Promise<void> {
  if (noteIds.length === 0) return;
  await db.query(
    `UPDATE piece_notes SET delivered_at = now(), delivered_run_id = $2
     WHERE id = ANY($1::uuid[]) AND delivered_at IS NULL`,
    [noteIds, runId],
  );
}

export async function urgentNotesForRun(db: Queryable, runId: string): Promise<StoredNote[]> {
  const { rows } = await db.query<NoteRow>(
    `SELECT n.* FROM runs r
     JOIN piece_lists l ON l.orchestration_run_id = r.parent_run_id
     JOIN task_pieces p ON p.piece_list_id = l.id AND p.key = r.route->>'pieceKey'
     JOIN piece_notes n ON n.piece_id = p.id
     WHERE r.id = $1 AND n.urgent AND n.delivered_at IS NULL AND n.created_at > r.created_at
       AND n.kind IN ('steer', 'requirement_added', 'contract_changed')
     ORDER BY n.created_at, n.id`,
    [runId],
  );
  return rows.map(toNote);
}

export async function addRequirement(
  db: Queryable,
  pieceId: string,
  requirement: string,
): Promise<void> {
  await db.query(
    `UPDATE task_pieces SET acceptance = array_append(acceptance, $2),
       contract_version = contract_version + 1
     WHERE id = $1`,
    [pieceId, requirement],
  );
}

export async function bumpContract(db: Queryable, pieceId: string): Promise<void> {
  await db.query('UPDATE task_pieces SET contract_version = contract_version + 1 WHERE id = $1', [
    pieceId,
  ]);
}

export async function runningPieceRuns(db: Queryable, pieceId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT r.id FROM task_pieces p
     JOIN piece_lists l ON l.id = p.piece_list_id
     JOIN runs r ON r.parent_run_id = l.orchestration_run_id AND r.route->>'pieceKey' = p.key
     WHERE p.id = $1 AND r.status IN ('queued', 'running', 'awaiting_approval')`,
    [pieceId],
  );
  return rows.map((row) => row.id);
}
