import { z } from 'zod';

export const pullRequestStateSchema = z.enum([
  'draft',
  'review',
  'changes_requested',
  'approved',
  'merged',
  'closed',
]);
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;

export const pullRequestChecksSchema = z.enum(['passing', 'failing', 'pending']);
export type PullRequestChecks = z.infer<typeof pullRequestChecksSchema>;

export const pullRequestStatusSchema = z.object({
  url: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  state: pullRequestStateSchema,
  openedAt: z.string(),
  mergedAt: z.string().nullable(),
  checks: pullRequestChecksSchema.nullable(),
  headSha: z.string().nullable().optional(),
  failedChecks: z.array(z.string()).optional(),
  author: z.string().nullable().optional(),
});
export type PullRequestStatus = z.infer<typeof pullRequestStatusSchema>;

export const ticketPullOriginSchema = z.enum(['spark', 'linked', 'matched']);
export type TicketPullOrigin = z.infer<typeof ticketPullOriginSchema>;

export const reportedPullStateSchema = z.enum(['open', 'draft', 'merged', 'declined', 'unknown']);
export type ReportedPullState = z.infer<typeof reportedPullStateSchema>;

export const ticketPullSchema = z.object({
  url: z.string(),
  repo: z.string().nullable(),
  number: z.number().int().positive().nullable(),
  title: z.string().nullable(),
  origin: ticketPullOriginSchema,
  branch: z.string().nullable(),
  author: z.string().nullable(),
  updatedAt: z.string().nullable(),
  reported: reportedPullStateSchema,
  status: pullRequestStatusSchema.nullable(),
  mine: z.boolean(),
});
export type TicketPull = z.infer<typeof ticketPullSchema>;

export const ticketBranchSchema = z.object({
  name: z.string(),
  url: z.string().nullable(),
  repo: z.string().nullable(),
});
export type TicketBranch = z.infer<typeof ticketBranchSchema>;

export const ticketCommitsSchema = z.object({
  count: z.number().int().nonnegative(),
  lastAt: z.string().nullable(),
});
export type TicketCommits = z.infer<typeof ticketCommitsSchema>;

export const ticketBuildsSchema = z.object({
  count: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
});
export type TicketBuilds = z.infer<typeof ticketBuildsSchema>;

export const ticketDevelopmentSchema = z.object({
  availability: z.enum(['ok', 'unavailable']),
  pullRequests: z.array(ticketPullSchema),
  branches: z.array(ticketBranchSchema),
  commits: ticketCommitsSchema.nullable(),
  builds: ticketBuildsSchema.nullable(),
});
export type TicketDevelopment = z.infer<typeof ticketDevelopmentSchema>;
