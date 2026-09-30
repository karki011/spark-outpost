import { z } from 'zod';

export const PIECE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/;

export const pieceSizeSchema = z.enum(['S', 'M', 'L']);
export type PieceSize = z.infer<typeof pieceSizeSchema>;

export const pieceDraftSchema = z.object({
  key: z.string().regex(PIECE_KEY_PATTERN),
  title: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(800),
  owns: z.array(z.string().trim().min(1).max(300)).max(60).default([]),
  reads: z.array(z.string().trim().min(1).max(300)).max(60).default([]),
  dependsOn: z.array(z.string()).max(8).default([]),
  contract: z.string().trim().max(2_000).nullable().default(null),
  acceptance: z.array(z.string().trim().min(1).max(400)).max(12).default([]),
  checks: z.array(z.string().trim().min(1).max(400)).max(6).default([]),
  size: pieceSizeSchema,
  research: z.boolean().default(false),
});
export type PieceDraft = z.infer<typeof pieceDraftSchema>;

export const piecesBlockSchema = z.object({
  pieces: z.array(pieceDraftSchema).min(1),
  integration: z.string().trim().max(2_000).nullable().default(null),
});
export type PiecesBlock = z.infer<typeof piecesBlockSchema>;

export const listPlacementSchema = z.enum(['in_order', 'shared', 'worktree']);
export type ListPlacement = z.infer<typeof listPlacementSchema>;

export const piecePlacementSchema = z.enum(['in_order', 'shared', 'worktree', 'read_only']);
export type PiecePlacement = z.infer<typeof piecePlacementSchema>;

export const pieceStatusSchema = z.enum([
  'pending',
  'ready',
  'running',
  'landed',
  'skipped',
  'failed',
]);
export type PieceStatus = z.infer<typeof pieceStatusSchema>;

export const pieceListStatusSchema = z.enum(['proposed', 'approved', 'superseded', 'rejected']);
export type PieceListStatus = z.infer<typeof pieceListStatusSchema>;

export const pieceViolationSchema = z.object({
  path: z.string(),
  action: z.enum(['refused', 'moved', 'reverted', 'kept', 'asked']),
  owner: z.string().nullable(),
});
export type PieceViolation = z.infer<typeof pieceViolationSchema>;

export const pieceCheckSchema = z.enum(['passed', 'failed', 'none']);
export type PieceCheck = z.infer<typeof pieceCheckSchema>;

export const taskPieceSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  title: z.string(),
  goal: z.string(),
  owns: z.array(z.string()),
  reads: z.array(z.string()),
  dependsOn: z.array(z.string()),
  contract: z.string().nullable(),
  contractVersion: z.number().int().positive(),
  acceptance: z.array(z.string()),
  checks: z.array(z.string()),
  research: z.boolean(),
  sizeEstimate: z.number().int().nonnegative(),
  placement: piecePlacementSchema,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  builderRunId: z.uuid().nullable(),
  builderName: z.string().nullable(),
  status: pieceStatusSchema,
  attempts: z.number().int().nonnegative(),
  fixTurns: z.number().int().nonnegative(),
  filesChanged: z.array(z.string()),
  violations: z.array(pieceViolationSchema),
  check: pieceCheckSchema.nullable(),
  costUsd: z.number().nonnegative().nullable(),
  landedAt: z.string().nullable(),
  note: z.string().nullable(),
  notesQueued: z.number().int().nonnegative().default(0),
});
export type TaskPiece = z.infer<typeof taskPieceSchema>;

export const pieceListSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  version: z.number().int().positive(),
  planVersion: z.number().int().positive().nullable(),
  piecesHash: z.string(),
  placement: listPlacementSchema,
  placementReason: z.string(),
  status: pieceListStatusSchema,
  integration: z.string().nullable(),
  pieces: z.array(taskPieceSchema),
  createdAt: z.string(),
});
export type PieceList = z.infer<typeof pieceListSchema>;

export const PIECES_ACTIVITY = 'pieces';

export type PieceTone = 'waiting' | 'running' | 'done' | 'skipped' | 'failed';

export interface PieceBoardRow {
  key: string;
  title: string;
  builder: string | null;
  provider: string | null;
  model: string | null;
  placement: string;
  status: string;
  tone: PieceTone;
  check: string | null;
  costUsd: number | null;
  notes: string | null;
  note: string | null;
  folded: boolean;
}

function fileCount(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

export function placementLabel(piece: Pick<TaskPiece, 'placement' | 'owns' | 'builderName'>) {
  if (piece.placement === 'read_only') return 'read-only';
  if (piece.placement === 'shared') return `shared tree · owns ${fileCount(piece.owns.length)}`;
  if (piece.placement === 'worktree') {
    return piece.builderName ? `${piece.builderName}'s copy` : 'own copy';
  }
  return 'in order';
}

function waitingOn(piece: TaskPiece, landed: ReadonlySet<string>): string[] {
  return piece.dependsOn.filter((key) => !landed.has(key));
}

function statusOf(
  piece: TaskPiece,
  landed: ReadonlySet<string>,
): { status: string; tone: PieceTone } {
  switch (piece.status) {
    case 'running':
      return { status: 'running', tone: 'running' };
    case 'landed':
      return { status: 'landed', tone: 'done' };
    case 'skipped':
      return { status: 'skipped', tone: 'skipped' };
    case 'failed':
      return { status: 'failed', tone: 'failed' };
    default: {
      const waiting = waitingOn(piece, landed);
      return waiting.length > 0
        ? { status: `waiting on ${waiting.join(', ')}`, tone: 'waiting' }
        : { status: 'ready', tone: 'waiting' };
    }
  }
}

function notesLabel(count: number): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? 'note' : 'notes'} queued`;
}

function checkLabel(piece: TaskPiece): string | null {
  if (piece.check === 'passed') return 'scoped check passed';
  if (piece.check === 'failed') return 'scoped check failed';
  return null;
}

export function pieceBoard(list: Pick<PieceList, 'pieces'>): PieceBoardRow[] {
  const landed = new Set(
    list.pieces.filter((piece) => piece.status === 'landed').map((piece) => piece.key),
  );
  return list.pieces.map((piece) => ({
    key: piece.key,
    title: piece.title,
    builder: piece.builderName,
    provider: piece.provider,
    model: piece.model,
    placement: placementLabel(piece),
    ...statusOf(piece, landed),
    check: checkLabel(piece),
    costUsd: piece.costUsd,
    notes: notesLabel(piece.notesQueued),
    note: piece.status === 'failed' || piece.status === 'skipped' ? piece.note : null,
    folded: piece.status === 'landed',
  }));
}
