import { z } from 'zod';
import { githubInboxReviewSummarySchema } from './github-review.ts';
import { pullRequestChecksSchema } from './ticket-development.ts';

export const githubInboxWindowDaysSchema = z.union([z.literal(14), z.literal(30)]);
export type GithubInboxWindowDays = z.infer<typeof githubInboxWindowDaysSchema>;

export const githubInboxGroupSchema = z.enum([
  'review_requested',
  'needs_fixes',
  'ready_to_merge',
  'waiting',
]);
export type GithubInboxGroup = z.infer<typeof githubInboxGroupSchema>;

export const githubInboxTicketSchema = z.object({
  source: z.string(),
  key: z.string(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  url: z.string().nullable(),
});
export type GithubInboxTicket = z.infer<typeof githubInboxTicketSchema>;

export const githubInboxItemSchema = z.object({
  id: z.string(),
  url: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  author: z.string(),
  authorIsBot: z.boolean(),
  mine: z.boolean(),
  group: githubInboxGroupSchema,
  draft: z.boolean(),
  checks: pullRequestChecksSchema.nullable(),
  failingChecks: z.number().int().nonnegative(),
  conflict: z.boolean(),
  behind: z.boolean(),
  openThreads: z.number().int().nonnegative().nullable(),
  changesRequested: z.boolean(),
  approvedBy: z.array(z.string()),
  waitingOn: z.array(z.string()),
  headSha: z.string(),
  updatedAt: z.string(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  changedFiles: z.number().int().nonnegative().nullable(),
  projectId: z.string().nullable(),
  conversationId: z.string().nullable(),
  ticket: githubInboxTicketSchema.nullable(),
  unseen: z.boolean(),
  updatedSinceSeen: z.boolean(),
  review: githubInboxReviewSummarySchema.nullable().optional(),
});
export type GithubInboxItem = z.infer<typeof githubInboxItemSchema>;

export const githubInboxProblemSchema = z.object({
  repo: z.string().nullable(),
  message: z.string(),
});
export type GithubInboxProblem = z.infer<typeof githubInboxProblemSchema>;

export const githubInboxSchema = z.object({
  connected: z.boolean(),
  login: z.string().nullable(),
  windowDays: githubInboxWindowDaysSchema,
  fetchedAt: z.string().nullable(),
  items: z.array(githubInboxItemSchema),
  problems: z.array(githubInboxProblemSchema),
});
export type GithubInbox = z.infer<typeof githubInboxSchema>;

export const githubInboxSeenRequestSchema = z.object({
  id: z.string().min(1),
  headSha: z.string().min(1),
});
export type GithubInboxSeenRequest = z.infer<typeof githubInboxSeenRequestSchema>;

export const githubInboxWindowRequestSchema = z.object({
  windowDays: githubInboxWindowDaysSchema,
});
export type GithubInboxWindowRequest = z.infer<typeof githubInboxWindowRequestSchema>;
