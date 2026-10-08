import { z } from 'zod';

export const pieceSizeSchema = z.enum(['S', 'M', 'L']);
export type PieceSize = z.infer<typeof pieceSizeSchema>;

export const PIECE_LIMITS = {
  key: 16,
  title: 120,
  goal: 800,
  path: 300,
  paths: 60,
  dependsOn: 8,
  contract: 2_000,
  item: 400,
  acceptance: 12,
  checks: 6,
  integration: 2_000,
} as const;

export const PIECE_KEY_PATTERN = new RegExp(`^[A-Za-z][A-Za-z0-9_-]{0,${PIECE_LIMITS.key - 1}}$`);

const pathList = z.array(z.string().trim().min(1).max(PIECE_LIMITS.path)).max(PIECE_LIMITS.paths);
const itemText = z.string().trim().min(1).max(PIECE_LIMITS.item);

export const pieceDraftSchema = z.object({
  key: z.string().regex(PIECE_KEY_PATTERN),
  title: z.string().trim().min(1).max(PIECE_LIMITS.title),
  goal: z.string().trim().min(1).max(PIECE_LIMITS.goal),
  owns: pathList.default([]),
  reads: pathList.default([]),
  dependsOn: z.array(z.string()).max(PIECE_LIMITS.dependsOn).default([]),
  contract: z.string().trim().max(PIECE_LIMITS.contract).nullable().default(null),
  acceptance: z.array(itemText).max(PIECE_LIMITS.acceptance).default([]),
  checks: z.array(itemText).max(PIECE_LIMITS.checks).default([]),
  size: pieceSizeSchema,
  research: z.boolean().default(false),
});
export type PieceDraft = z.infer<typeof pieceDraftSchema>;

export const piecesBlockSchema = z.object({
  pieces: z.array(pieceDraftSchema).min(1),
  integration: z.string().trim().max(PIECE_LIMITS.integration).nullable().default(null),
});
export type PiecesBlock = z.infer<typeof piecesBlockSchema>;

export function pieceLimitLines(): string[] {
  const limits = PIECE_LIMITS;
  return [
    `key: a letter, then letters, digits, _ or -, at most ${limits.key} characters.`,
    `title at most ${limits.title} characters; goal at most ${limits.goal}; contract at most ${limits.contract}; integration at most ${limits.integration}.`,
    `acceptance: at most ${limits.acceptance} items; checks: at most ${limits.checks} commands; each at most ${limits.item} characters.`,
    `owns and reads: at most ${limits.paths} paths each, each at most ${limits.path} characters; dependsOn: at most ${limits.dependsOn} keys.`,
  ];
}

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

export const PIECES_ACTIVITY = 'pieces';

export type PieceTone = 'waiting' | 'running' | 'done' | 'skipped' | 'failed' | 'stopped';

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
  pick: string | null;
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
    case 'stopped':
      return { status: 'stopped', tone: 'stopped' };
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

const NOTED_STATUSES: ReadonlySet<PieceStatus> = new Set(['failed', 'skipped', 'stopped']);

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
    note: NOTED_STATUSES.has(piece.status) ? piece.note : null,
    pick: piece.pickNote,
    folded: piece.status === 'landed',
  }));
}
