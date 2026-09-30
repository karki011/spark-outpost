import {
  pieceListSchema,
  type ListPlacement,
  type PieceCheck,
  type PieceList,
  type PiecePlacement,
  type PieceStatus,
  type PieceViolation,
  type TaskPiece,
} from '@spark-outpost/contracts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface NewPiece {
  key: string;
  title: string;
  goal: string;
  owns: readonly string[];
  reads: readonly string[];
  dependsOn: readonly string[];
  contract: string | null;
  acceptance: readonly string[];
  checks: readonly string[];
  research: boolean;
  sizeEstimate: number;
  placement: PiecePlacement;
  provider: string | null;
  model: string | null;
}

export interface NewPieceList {
  taskId: string;
  orchestrationRunId: string;
  planDocumentId: string | null;
  planVersion: number | null;
  piecesHash: string;
  placement: ListPlacement;
  placementReason: string;
  integration: string | null;
  approvedBy: 'user' | 'level' | null;
  pieces: readonly NewPiece[];
}

interface ListRow {
  id: string;
  task_id: string;
  version: number;
  plan_version: number | null;
  pieces_hash: string;
  placement: ListPlacement;
  placement_reason: string;
  status: PieceList['status'];
  integration: string | null;
  created_at: Date;
}

interface PieceRow {
  id: string;
  piece_list_id: string;
  key: string;
  title: string;
  goal: string;
  owns: string[];
  reads: string[];
  depends_on: string[];
  contract: string | null;
  contract_version: number;
  acceptance: string[];
  checks: string[];
  research: boolean;
  size_estimate: number;
  placement: PiecePlacement;
  provider: string | null;
  model: string | null;
  builder_run_id: string | null;
  builder_name: string | null;
  status: PieceStatus;
  attempts: number;
  fix_turns: number;
  files_changed: string[];
  violations: PieceViolation[];
  check_status: PieceCheck | null;
  cost_usd: string | null;
  landed_at: Date | null;
  note: string | null;
  notes_queued: number;
}

function toPiece(row: PieceRow): TaskPiece {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    goal: row.goal,
    owns: row.owns,
    reads: row.reads,
    dependsOn: row.depends_on,
    contract: row.contract,
    contractVersion: row.contract_version,
    acceptance: row.acceptance,
    checks: row.checks,
    research: row.research,
    sizeEstimate: row.size_estimate,
    placement: row.placement,
    provider: row.provider,
    model: row.model,
    builderRunId: row.builder_run_id,
    builderName: row.builder_name,
    status: row.status,
    attempts: row.attempts,
    fixTurns: row.fix_turns,
    filesChanged: row.files_changed,
    violations: row.violations,
    check: row.check_status,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    landedAt: row.landed_at?.toISOString() ?? null,
    note: row.note,
    notesQueued: row.notes_queued,
  };
}

function toList(row: ListRow, pieces: readonly PieceRow[]): PieceList {
  return pieceListSchema.parse({
    id: row.id,
    taskId: row.task_id,
    version: row.version,
    planVersion: row.plan_version,
    piecesHash: row.pieces_hash,
    placement: row.placement,
    placementReason: row.placement_reason,
    status: row.status,
    integration: row.integration,
    pieces: pieces.filter((piece) => piece.piece_list_id === row.id).map(toPiece),
    createdAt: row.created_at.toISOString(),
  });
}

const PIECE_COLUMNS = `p.*, COALESCE(b.route->>'name',
    (SELECT r.route->>'name' FROM runs r
     WHERE r.parent_run_id = l.orchestration_run_id AND r.route->>'pieceKey' = p.key
     ORDER BY r.created_at DESC LIMIT 1)) AS builder_name,
  (SELECT SUM(r.cost_usd) FROM runs r
   WHERE r.parent_run_id = l.orchestration_run_id AND r.route->>'pieceKey' = p.key) AS cost_usd,
  (SELECT COUNT(*)::int FROM piece_notes n
   WHERE n.piece_id = p.id AND n.delivered_at IS NULL) AS notes_queued`;

async function piecesOf(db: Queryable, listIds: readonly string[]): Promise<PieceRow[]> {
  if (listIds.length === 0) return [];
  const { rows } = await db.query<PieceRow>(
    `SELECT ${PIECE_COLUMNS} FROM task_pieces p
     JOIN piece_lists l ON l.id = p.piece_list_id
     LEFT JOIN runs b ON b.id = p.builder_run_id
     WHERE p.piece_list_id = ANY($1::uuid[]) ORDER BY p.position`,
    [listIds],
  );
  return rows;
}

export async function insertPieceList(db: Db, list: NewPieceList): Promise<PieceList> {
  const id = newId();
  await withTransaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [list.taskId]);
    await client.query(
      `UPDATE piece_lists SET status = 'superseded'
       WHERE task_id = $1 AND status IN ('proposed', 'approved')`,
      [list.taskId],
    );
    await client.query(
      `INSERT INTO piece_lists (id, task_id, orchestration_run_id, version, plan_document_id,
         plan_version, pieces_hash, placement, placement_reason, integration, status, approved_by)
       SELECT $1, $2, $3, COALESCE(MAX(version), 0) + 1, $4, $5, $6, $7, $8, $9, $10, $11
       FROM piece_lists WHERE task_id = $2`,
      [
        id,
        list.taskId,
        list.orchestrationRunId,
        list.planDocumentId,
        list.planVersion,
        list.piecesHash,
        list.placement,
        list.placementReason,
        list.integration,
        list.approvedBy ? 'approved' : 'proposed',
        list.approvedBy,
      ],
    );
    for (const [position, piece] of list.pieces.entries()) {
      await client.query(
        `INSERT INTO task_pieces (id, piece_list_id, position, key, title, goal, owns, reads,
           depends_on, contract, acceptance, checks, research, size_estimate, placement,
           provider, model, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
           'pending')`,
        [
          newId(),
          id,
          position,
          piece.key,
          piece.title,
          piece.goal,
          piece.owns,
          piece.reads,
          piece.dependsOn,
          piece.contract,
          piece.acceptance,
          piece.checks,
          piece.research,
          piece.sizeEstimate,
          piece.placement,
          piece.provider,
          piece.model,
        ],
      );
    }
  });
  return (await pieceListById(db, id))!;
}

export async function pieceListById(db: Queryable, id: string): Promise<PieceList | null> {
  const { rows } = await db.query<ListRow>('SELECT * FROM piece_lists WHERE id = $1', [id]);
  return rows[0] ? toList(rows[0], await piecesOf(db, [id])) : null;
}

export async function currentPieceList(db: Queryable, taskId: string): Promise<PieceList | null> {
  const { rows } = await db.query<ListRow>(
    `SELECT * FROM piece_lists WHERE task_id = $1 AND status IN ('proposed', 'approved')
     ORDER BY version DESC LIMIT 1`,
    [taskId],
  );
  return rows[0] ? toList(rows[0], await piecesOf(db, [rows[0].id])) : null;
}

export async function pieceListsForRuns(
  db: Queryable,
  runIds: readonly string[],
): Promise<Map<string, PieceList>> {
  const { rows } = await db.query<ListRow & { orchestration_run_id: string }>(
    `SELECT DISTINCT ON (orchestration_run_id) * FROM piece_lists
     WHERE orchestration_run_id = ANY($1::uuid[])
     ORDER BY orchestration_run_id, version DESC`,
    [runIds],
  );
  const pieces = await piecesOf(
    db,
    rows.map((row) => row.id),
  );
  return new Map(rows.map((row) => [row.orchestration_run_id, toList(row, pieces)]));
}

export interface PiecePatch {
  builderRunId?: string;
  owns?: readonly string[];
  provider?: string;
  model?: string | null;
  attempts?: number;
  fixTurns?: number;
  filesChanged?: readonly string[];
  violations?: readonly PieceViolation[];
  check?: PieceCheck;
  note?: string | null;
}

const PATCH_COLUMNS: Record<keyof PiecePatch, string> = {
  builderRunId: 'builder_run_id',
  owns: 'owns',
  provider: 'provider',
  model: 'model',
  attempts: 'attempts',
  fixTurns: 'fix_turns',
  filesChanged: 'files_changed',
  violations: 'violations',
  check: 'check_status',
  note: 'note',
};

function patchValue(key: keyof PiecePatch, value: unknown): unknown {
  return key === 'violations' ? JSON.stringify(value) : value;
}

export async function movePiece(
  db: Queryable,
  pieceId: string,
  from: readonly PieceStatus[],
  to: PieceStatus,
  patch: PiecePatch = {},
): Promise<boolean> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [
    keyof PiecePatch,
    unknown,
  ][];
  const sets = entries.map(([key], index) => `${PATCH_COLUMNS[key]} = $${index + 4}`);
  const { rowCount } = await db.query(
    `UPDATE task_pieces SET status = $2,
       landed_at = CASE WHEN $2 = 'landed' THEN now() ELSE landed_at END
       ${sets.length > 0 ? `, ${sets.join(', ')}` : ''}
     WHERE id = $1 AND status = ANY($3::text[])`,
    [pieceId, to, from, ...entries.map(([key, value]) => patchValue(key, value))],
  );
  return rowCount === 1;
}

export async function failRunningPieces(db: Queryable, note: string): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE task_pieces p SET status = 'failed', note = $1
     FROM piece_lists l JOIN runs r ON r.id = l.orchestration_run_id
     WHERE p.piece_list_id = l.id AND p.status = 'running'
       AND r.status NOT IN ('running', 'awaiting_approval', 'queued')`,
    [note],
  );
  return rowCount ?? 0;
}
