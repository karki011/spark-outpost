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
import type { Queryable } from './db.ts';

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
  pick_note: string | null;
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
    pickNote: row.pick_note,
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

export async function skipUnstartedPieces(db: Queryable, note: string): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE task_pieces p SET status = 'skipped', note = $1
     FROM piece_lists l JOIN runs r ON r.id = l.orchestration_run_id
     WHERE p.piece_list_id = l.id AND p.status IN ('pending', 'ready')
       AND r.status NOT IN ('running', 'awaiting_approval', 'queued')`,
    [note],
  );
  return rowCount ?? 0;
}
