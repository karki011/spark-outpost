import { z } from 'zod';

export const outcomeSignalKindSchema = z.enum([
  'kept',
  'checks_passed',
  'quiet_24h',
  'committed',
  'reverted',
  'correction',
  're_ask',
  'checks_failed',
  'cancelled',
  'failed',
  'pr_merged',
  'pr_closed',
  'pr_reverted',
  'pr_review_comments',
]);
export type OutcomeSignalKind = z.infer<typeof outcomeSignalKindSchema>;

export const outcomeSignalSourceSchema = z.enum([
  'user',
  'harness',
  'git',
  'jev',
  'heuristic',
  'timer',
  'pr',
]);
export type OutcomeSignalSource = z.infer<typeof outcomeSignalSourceSchema>;

export const outcomeSignalSchema = z.object({
  kind: outcomeSignalKindSchema,
  polarity: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  source: outcomeSignalSourceSchema,
  at: z.string(),
  detail: z.record(z.string(), z.unknown()),
});
export type OutcomeSignal = z.infer<typeof outcomeSignalSchema>;

export const outcomeKindSchema = z.enum(['change', 'answer', 'other']);
export type OutcomeKind = z.infer<typeof outcomeKindSchema>;

export const outcomeVerdictSchema = z.enum(['good', 'bad', 'mixed', 'unclear']);
export type OutcomeVerdict = z.infer<typeof outcomeVerdictSchema>;

export const feedbackPromptSchema = z.enum(['mixed', 'sampled']);
export type FeedbackPrompt = z.infer<typeof feedbackPromptSchema>;

export const feedbackRatingSchema = z.enum(['up', 'down']);
export type FeedbackRating = z.infer<typeof feedbackRatingSchema>;

export const feedbackReasonSchema = z.enum([
  'wrong_approach',
  'broke_something',
  'too_much_change',
  'other',
]);
export type FeedbackReason = z.infer<typeof feedbackReasonSchema>;

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  wrong_approach: 'Wrong approach',
  broke_something: 'Broke something',
  too_much_change: 'Too much change',
  other: 'Other',
};

export const FEEDBACK_COMMENT_MAX_LENGTH = 2000;

export const outcomeFeedbackSchema = z.object({
  rating: feedbackRatingSchema,
  reasons: z.array(feedbackReasonSchema),
  comment: z.string().nullable(),
  at: z.string(),
});
export type OutcomeFeedback = z.infer<typeof outcomeFeedbackSchema>;

export const outcomeReasonSchema = z.object({
  label: z.string(),
  weight: z.number(),
});
export type OutcomeReason = z.infer<typeof outcomeReasonSchema>;

export const turnOutcomeSchema = z.object({
  runId: z.uuid(),
  taskId: z.uuid().nullable(),
  kind: outcomeKindSchema,
  score: z.number().min(-1).max(1).nullable(),
  verdict: outcomeVerdictSchema,
  reasons: z.array(outcomeReasonSchema),
  prompt: feedbackPromptSchema.nullable(),
  feedback: outcomeFeedbackSchema.nullable(),
  signals: z.array(outcomeSignalSchema),
});
export type TurnOutcome = z.infer<typeof turnOutcomeSchema>;

export const saveFeedbackRequestSchema = z.object({
  rating: feedbackRatingSchema,
  reasons: z.array(feedbackReasonSchema).max(4).default([]),
  comment: z.string().trim().max(FEEDBACK_COMMENT_MAX_LENGTH).optional(),
});
export type SaveFeedbackRequest = z.input<typeof saveFeedbackRequestSchema>;
export type SaveFeedback = z.output<typeof saveFeedbackRequestSchema>;

export const outcomeGroupBySchema = z.enum([
  'day',
  'project',
  'provider',
  'model',
  'category',
  'jev_decision',
  'jev_vs_rules',
]);
export type OutcomeGroupBy = z.infer<typeof outcomeGroupBySchema>;

export const outcomeQuerySchema = z.object({
  groupBy: outcomeGroupBySchema.default('day'),
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type OutcomeQuery = z.infer<typeof outcomeQuerySchema>;

export const outcomeGroupSchema = z.object({
  key: z.string(),
  turns: z.number().int().nonnegative(),
  good: z.number().int().nonnegative(),
  bad: z.number().int().nonnegative(),
  mixed: z.number().int().nonnegative(),
  unclear: z.number().int().nonnegative(),
  meanScore: z.number().nullable(),
  rated: z.number().int().nonnegative(),
  thumbsUp: z.number().int().nonnegative(),
  thumbsDown: z.number().int().nonnegative(),
  prompted: z.number().int().nonnegative(),
  sampled: z.number().int().nonnegative(),
  kept: z.number().int().nonnegative(),
  reverted: z.number().int().nonnegative(),
  committed: z.number().int().nonnegative(),
  corrections: z.number().int().nonnegative(),
});
export type OutcomeGroup = z.infer<typeof outcomeGroupSchema>;

export const outcomeReportSchema = z.object({
  groupBy: outcomeGroupBySchema,
  days: z.number().int(),
  groups: z.array(outcomeGroupSchema),
});
export type OutcomeReport = z.infer<typeof outcomeReportSchema>;

export const outcomeResponseSchema = z.object({ outcome: turnOutcomeSchema.nullable() });
export type OutcomeResponse = z.infer<typeof outcomeResponseSchema>;
