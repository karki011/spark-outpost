import { z } from 'zod';

export const githubPullIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}#[1-9]\d{0,9}$/);

export const githubReviewerKindSchema = z.enum(['spark', 'workflow']);
export type GithubReviewerKind = z.infer<typeof githubReviewerKindSchema>;

export const githubReviewerChoiceSchema = z.object({
  kind: githubReviewerKindSchema,
  id: z.string().min(1).max(200),
});
export type GithubReviewerChoice = z.infer<typeof githubReviewerChoiceSchema>;

export const githubReviewSettingsSchema = z.object({
  reviewer: githubReviewerChoiceSchema.nullable(),
  reviewerName: z.string().nullable(),
  autoReview: z.boolean(),
  mayPost: z.boolean(),
  mayApprove: z.boolean(),
});
export type GithubReviewSettings = z.infer<typeof githubReviewSettingsSchema>;

export const githubReviewSettingsUpdateSchema = z.object({
  reviewer: githubReviewerChoiceSchema.nullable(),
  autoReview: z.boolean(),
  mayPost: z.boolean(),
  mayApprove: z.boolean(),
});
export type GithubReviewSettingsUpdate = z.infer<typeof githubReviewSettingsUpdateSchema>;

export const githubReviewStateSchema = z.enum(['queued', 'running', 'done', 'failed', 'stopped']);
export type GithubReviewState = z.infer<typeof githubReviewStateSchema>;

export const githubReviewPostKindSchema = z.enum(['comment', 'approve']);
export type GithubReviewPostKind = z.infer<typeof githubReviewPostKindSchema>;

export const githubReviewPostedSchema = z.object({
  kind: githubReviewPostKindSchema,
  url: z.string().nullable(),
  at: z.string(),
});
export type GithubReviewPosted = z.infer<typeof githubReviewPostedSchema>;

export const githubReviewSchema = z.object({
  id: z.string(),
  pull: z.string(),
  headSha: z.string(),
  reviewer: z.object({
    kind: githubReviewerKindSchema,
    id: z.string(),
    name: z.string(),
  }),
  state: githubReviewStateSchema,
  body: z.string().nullable(),
  error: z.string().nullable(),
  requestedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  posted: z.array(githubReviewPostedSchema),
  costUsd: z.number().nonnegative().nullable(),
  tokens: z.number().int().nonnegative().nullable(),
});
export type GithubReview = z.infer<typeof githubReviewSchema>;

export const githubReviewListSchema = z.object({
  reviews: z.array(githubReviewSchema),
});
export type GithubReviewList = z.infer<typeof githubReviewListSchema>;

export const githubReviewRequestSchema = z.object({
  pull: githubPullIdSchema,
});
export type GithubReviewRequest = z.infer<typeof githubReviewRequestSchema>;

export const githubInboxReviewSummarySchema = z.object({
  state: githubReviewStateSchema,
  headSha: z.string(),
  stale: z.boolean(),
  posted: githubReviewPostKindSchema.nullable(),
});
export type GithubInboxReviewSummary = z.infer<typeof githubInboxReviewSummarySchema>;
