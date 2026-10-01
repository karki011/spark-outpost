import { z } from 'zod';

export const PR_FOLLOW_UP_MAX_ROUNDS = 3;

export const feedbackKindSchema = z.enum(['check', 'review_comment', 'review', 'issue_comment']);
export type FeedbackKind = z.infer<typeof feedbackKindSchema>;

export const feedbackTriageSchema = z.enum([
  'fix',
  'question',
  'disagree',
  'nit',
  'addressed',
  'info',
]);
export type FeedbackTriage = z.infer<typeof feedbackTriageSchema>;

export const feedbackStateSchema = z.enum([
  'queued',
  'held',
  'needs_user',
  'in_round',
  'planned',
  'done',
  'skipped',
]);
export type FeedbackState = z.infer<typeof feedbackStateSchema>;

export const prWatchPhaseSchema = z.enum(['watching', 'fixing', 'confirming', 'needs_you', 'done']);
export type PrWatchPhase = z.infer<typeof prWatchPhaseSchema>;

export const prChecksSchema = z.enum(['none', 'pending', 'passing', 'failing']);
export type PrChecks = z.infer<typeof prChecksSchema>;

export const feedbackItemSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  kind: feedbackKindSchema,
  author: z.string(),
  trusted: z.boolean(),
  path: z.string().nullable(),
  line: z.number().int().nullable(),
  excerpt: z.string(),
  url: z.string().nullable(),
  triage: feedbackTriageSchema,
  triagedBy: z.enum(['jev', 'rules']),
  state: feedbackStateSchema,
  round: z.number().int().nullable(),
  reply: z.string().nullable(),
});
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

export const prWatchSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  repo: z.string(),
  number: z.number().int().positive(),
  url: z.string(),
  branch: z.string(),
  phase: prWatchPhaseSchema,
  doing: z.string(),
  prState: z.enum(['open', 'merged', 'closed']),
  draft: z.boolean(),
  checks: prChecksSchema,
  rounds: z.number().int().nonnegative(),
  maxRounds: z.number().int().positive(),
  newComments: z.number().int().nonnegative(),
  approvalId: z.uuid().nullable(),
  lastPolledAt: z.string().nullable(),
  lastError: z.string().nullable(),
  items: z.array(feedbackItemSchema),
});
export type PrWatch = z.infer<typeof prWatchSchema>;

export const prWatchListSchema = z.object({ watches: z.array(prWatchSchema) });
export type PrWatchList = z.infer<typeof prWatchListSchema>;

export const feedbackTriageLabels: Record<FeedbackTriage, string> = {
  fix: 'Fix',
  question: 'Question',
  disagree: 'Needs you',
  nit: 'Nit',
  addressed: 'Already addressed',
  info: 'Information',
};
