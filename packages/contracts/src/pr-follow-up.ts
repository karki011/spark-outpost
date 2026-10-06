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

export const prReviewSchema = z.enum(['none', 'approved', 'changes_requested']);
export type PrReview = z.infer<typeof prReviewSchema>;

export const prOpenedViaSchema = z.enum(['ship', 'agent', 'terminal', 'discovery']);
export type PrOpenedVia = z.infer<typeof prOpenedViaSchema>;

export const prFailingCheckSchema = z.object({ name: z.string(), url: z.string().nullable() });
export type PrFailingCheck = z.infer<typeof prFailingCheckSchema>;

export const prCheckStateSchema = z.enum([
  'failing',
  'running',
  'passing',
  'cancelled',
  'skipped',
  'neutral',
]);
export type PrCheckState = z.infer<typeof prCheckStateSchema>;

export const prCheckRunSchema = z.object({
  name: z.string(),
  url: z.string().nullable(),
  state: prCheckStateSchema,
  summary: z.string().nullable(),
});
export type PrCheckRun = z.infer<typeof prCheckRunSchema>;

export const prReviewerSchema = z.object({
  user: z.string(),
  state: z.enum(['approved', 'changes_requested', 'commented']),
  at: z.string().nullable(),
  url: z.string().nullable(),
});
export type PrReviewer = z.infer<typeof prReviewerSchema>;

export const prThreadStatusSchema = z.enum([
  'fixed',
  'pushed_back',
  'answered',
  'needs_you',
  'fixing',
]);
export type PrThreadStatus = z.infer<typeof prThreadStatusSchema>;

export const prThreadSchema = z.object({
  key: z.string(),
  author: z.string(),
  path: z.string().nullable(),
  line: z.number().int().nullable(),
  excerpt: z.string(),
  url: z.string().nullable(),
  at: z.string().nullable(),
  status: prThreadStatusSchema.nullable(),
});
export type PrThread = z.infer<typeof prThreadSchema>;

export const prDetailsSchema = z.object({
  checkRuns: z.array(prCheckRunSchema),
  reviewers: z.array(prReviewerSchema),
  threads: z.array(prThreadSchema),
  threadCount: z.number().int().nonnegative(),
});
export type PrDetails = z.infer<typeof prDetailsSchema>;

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
  title: z.string().nullable(),
  branch: z.string(),
  base: z.string().nullable(),
  outside: z.boolean(),
  followUp: z.boolean(),
  opened: z.object({
    via: prOpenedViaSchema,
    by: z.string().nullable(),
    runId: z.uuid().nullable(),
    at: z.string(),
  }),
  phase: prWatchPhaseSchema,
  doing: z.string(),
  prState: z.enum(['open', 'merged', 'closed']),
  draft: z.boolean(),
  checks: prChecksSchema,
  failingChecks: z.array(prFailingCheckSchema),
  review: prReviewSchema,
  unknownReason: z.string().nullable(),
  rounds: z.number().int().nonnegative(),
  maxRounds: z.number().int().positive(),
  newComments: z.number().int().nonnegative(),
  approvalId: z.uuid().nullable(),
  lastPolledAt: z.string().nullable(),
  lastError: z.string().nullable(),
  items: z.array(feedbackItemSchema),
  details: prDetailsSchema,
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
