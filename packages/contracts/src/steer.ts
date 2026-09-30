import { z } from 'zod';
import { PIECE_KEY_PATTERN } from './pieces.ts';

export const pieceNoteKindSchema = z.enum([
  'merge_main',
  'contract_changed',
  'requirement_added',
  'skip',
  'stop',
  'reassign',
  'steer',
]);
export type PieceNoteKind = z.infer<typeof pieceNoteKindSchema>;

export const STEER_ALL = 'all';
export const STEER_COORDINATOR = 'coordinator';
export const STEER_AUTO = 'auto';

export const steerTargetSchema = z.union([
  z.literal(STEER_AUTO),
  z.literal(STEER_ALL),
  z.literal(STEER_COORDINATOR),
  z.string().regex(PIECE_KEY_PATTERN),
]);
export type SteerTarget = z.infer<typeof steerTargetSchema>;

export const STEER_TEXT_LIMIT = 4_000;

export const steerRequestSchema = z.object({
  text: z.string().trim().min(1).max(STEER_TEXT_LIMIT),
  target: steerTargetSchema.default(STEER_AUTO),
});
export type SteerRequest = z.infer<typeof steerRequestSchema>;

export const pieceNoteRequestSchema = z.object({
  kind: z.enum(['requirement_added', 'skip', 'stop', 'reassign', 'steer']),
  body: z.string().trim().min(1).max(STEER_TEXT_LIMIT),
  urgent: z.boolean().default(false),
});
export type PieceNoteRequest = z.infer<typeof pieceNoteRequestSchema>;

export const steerResponseSchema = z.object({
  kind: pieceNoteKindSchema,
  target: z.string(),
  pieces: z.array(z.string()),
  reply: z.string(),
});
export type SteerResponse = z.infer<typeof steerResponseSchema>;
