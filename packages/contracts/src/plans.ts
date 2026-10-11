import { z } from 'zod';

export const PLAN_DOCUMENT_MAX_LENGTH = 40_000;

export const planDocumentStatusSchema = z.enum(['proposed', 'approved', 'rejected', 'superseded']);
export type PlanDocumentStatus = z.infer<typeof planDocumentStatusSchema>;

export const planDocumentSourceSchema = z.enum(['claude_plan_mode', 'codex', 'chat', 'user']);
export type PlanDocumentSource = z.infer<typeof planDocumentSourceSchema>;

export const planDocumentSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  taskId: z.uuid().nullable(),
  version: z.number().int().positive(),
  status: planDocumentStatusSchema,
  source: planDocumentSourceSchema,
  body: z.string(),
  sourceRunId: z.uuid().nullable(),
  sourceMessageId: z.uuid().nullable(),
  approvedAt: z.string().nullable(),
  approvedBy: z.enum(['user', 'jev']).nullable(),
  approvedOption: z.string().nullable(),
  approvedCommit: z.string().nullable(),
  createdAt: z.string(),
});
export type PlanDocument = z.infer<typeof planDocumentSchema>;

export const agreedPlansSchema = z.object({
  documents: z.array(planDocumentSchema),
  staleFiles: z.array(z.string()),
});
export type AgreedPlans = z.infer<typeof agreedPlansSchema>;

export const planLineUnitSchema = z.enum(['pieces', 'steps']);
export type PlanLineUnit = z.infer<typeof planLineUnitSchema>;

export const planLineSchema = z.object({
  runId: z.uuid(),
  version: z.number().int().positive(),
  items: z.number().int().nonnegative(),
  unit: planLineUnitSchema,
});
export type PlanLine = z.infer<typeof planLineSchema>;

export const PLAN_SAVED_OPTION: Record<PlanLineUnit, string> = {
  pieces: 'build_pieces',
  steps: 'build_steps',
};

export function planSavedText(line: Pick<PlanLine, 'items' | 'unit'>): string {
  if (line.items === 0 || line.unit !== 'pieces') return 'Plan saved';
  return `Plan saved · ${line.items} ${line.items === 1 ? 'piece' : 'pieces'}`;
}

export const conversationPlansSchema = z.object({
  saved: z.array(z.object({ messageId: z.uuid(), version: z.number().int().positive() })),
  lines: z.array(planLineSchema).default([]),
});
export type ConversationPlans = z.infer<typeof conversationPlansSchema>;

export const PLAN_SOURCE_LABELS: Record<PlanDocumentSource, string> = {
  claude_plan_mode: 'Claude plan mode',
  codex: 'Codex plan',
  chat: 'agreed in chat',
  user: 'saved by you',
};
