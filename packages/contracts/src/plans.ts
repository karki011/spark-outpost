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

export const planOfferSchema = z.object({
  runId: z.uuid(),
  messageId: z.uuid(),
});
export type PlanOffer = z.infer<typeof planOfferSchema>;

export const conversationPlansSchema = z.object({
  saved: z.array(z.object({ messageId: z.uuid(), version: z.number().int().positive() })),
  offers: z.array(planOfferSchema),
});
export type ConversationPlans = z.infer<typeof conversationPlansSchema>;

export const savePlanRequestSchema = z.object({
  messageId: z.uuid(),
  offered: z.boolean().default(false),
});
export type SavePlanRequest = z.input<typeof savePlanRequestSchema>;

export const PLAN_SOURCE_LABELS: Record<PlanDocumentSource, string> = {
  claude_plan_mode: 'Claude plan mode',
  codex: 'Codex plan',
  chat: 'agreed in chat',
  user: 'saved by you',
};

const LIST_ITEM = /^\s{0,3}(?:\d+[.)]|[-*+])\s+\S/;
const PLAN_HEADING = /^\s{0,3}#{1,4}\s.*\b(plan|steps|approach)\b/im;

export function looksLikePlan(text: string): boolean {
  if (PLAN_HEADING.test(text)) return true;
  const items = text.split('\n').filter((line) => LIST_ITEM.test(line));
  return items.length >= 3;
}
