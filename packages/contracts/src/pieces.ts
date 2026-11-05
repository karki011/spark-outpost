import { z } from 'zod';

export const PIECES_FENCE = 'pieces';

const FENCED_BLOCK = /```([\w-]*)\s*\n([\s\S]*?)```/g;

export interface FencedBlock {
  start: number;
  end: number;
  tagged: boolean;
  body: string;
}

export function fencedPiecesBlock(text: string): FencedBlock | null {
  const blocks = [...text.matchAll(FENCED_BLOCK)];
  const tagged = blocks.find((block) => block[1] === PIECES_FENCE);
  const chosen = tagged ?? blocks.at(-1);
  if (!chosen) return null;
  return {
    start: chosen.index,
    end: chosen.index + chosen[0].length,
    tagged: tagged !== undefined,
    body: chosen[2]!,
  };
}

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
  'stopped',
]);
export type PieceStatus = z.infer<typeof pieceStatusSchema>;

export const pieceListStatusSchema = z.enum(['proposed', 'approved', 'superseded', 'rejected']);
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
  pickNote: z.string().nullable().default(null),
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
