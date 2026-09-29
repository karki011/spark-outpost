import { z } from 'zod';
import {
  TICKET_KEY_MAX_LENGTH,
  TICKET_SEARCH_MAX_LENGTH,
  ticketListItemSchema,
  ticketPersonSchema,
  ticketSourceIdSchema,
  ticketStatusSchema,
  ticketSummarySchema,
} from './tickets.ts';

export const ticketProblemKindSchema = z.enum(['auth', 'unreachable', 'other']);
export type TicketProblemKind = z.infer<typeof ticketProblemKindSchema>;

export const ticketSourceProblemSchema = z.object({
  source: ticketSourceIdSchema,
  message: z.string(),
  kind: ticketProblemKindSchema,
});
export type TicketSourceProblem = z.infer<typeof ticketSourceProblemSchema>;

export const ticketAssigneeFilterSchema = z.enum(['anyone', 'me', 'unassigned', 'others']);
export type TicketAssigneeFilter = z.infer<typeof ticketAssigneeFilterSchema>;

export const ticketSearchQuerySchema = z.object({
  q: z.string().trim().max(TICKET_SEARCH_MAX_LENGTH).default(''),
  source: ticketSourceIdSchema.optional(),
  project: z.string().trim().min(1).max(TICKET_KEY_MAX_LENGTH).optional(),
  status: ticketStatusSchema.optional(),
  assignee: ticketAssigneeFilterSchema.default('anyone'),
});
export type TicketSearchQuery = z.infer<typeof ticketSearchQuerySchema>;

export const ticketSearchResultSchema = ticketSummarySchema.extend({ mine: z.boolean() });
export type TicketSearchResult = z.infer<typeof ticketSearchResultSchema>;

export const ticketSearchSchema = z.object({
  tickets: z.array(ticketSearchResultSchema),
  errors: z.array(ticketSourceProblemSchema),
});
export type TicketSearch = z.infer<typeof ticketSearchSchema>;

export const assignTicketRequestSchema = z.object({
  to: z.union([z.literal('me'), z.null(), ticketPersonSchema]),
  expectedAssigneeId: z.string().max(200).nullable().optional(),
  confirmTakeover: z.boolean().default(false),
});
export type AssignTicketRequest = z.input<typeof assignTicketRequestSchema>;

export const assignTicketResponseSchema = z.object({
  ticket: ticketSummarySchema,
  previous: ticketPersonSchema.nullable(),
});
export type AssignTicketResponse = z.infer<typeof assignTicketResponseSchema>;

export const pullRequestStateSchema = z.enum([
  'draft',
  'review',
  'changes_requested',
  'approved',
  'merged',
  'closed',
]);
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;

export const pullRequestStatusSchema = z.object({
  url: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  state: pullRequestStateSchema,
  openedAt: z.string(),
  mergedAt: z.string().nullable(),
});
export type PullRequestStatus = z.infer<typeof pullRequestStatusSchema>;

export const attentionRuleSchema = z.enum([
  'chat-asking',
  'chat-error',
  'sync-failed',
  'blocked',
  'high-idle',
  'due-soon',
  'pr-changes',
  'pr-approved',
  'review-slow',
]);
export type AttentionRule = z.infer<typeof attentionRuleSchema>;

export const attentionFlagSchema = z.object({
  rule: attentionRuleSchema,
  text: z.string(),
  rationale: z.string(),
  since: z.string().nullable(),
  severity: z.enum(['warn', 'error']),
});
export type AttentionFlag = z.infer<typeof attentionFlagSchema>;

export const ticketSectionSchema = z.enum([
  'attention',
  'working',
  'pr_ready',
  'in_review',
  'up_next',
  'done',
]);
export type TicketSection = z.infer<typeof ticketSectionSchema>;

export const ticketChatStateSchema = z.enum(['asking', 'running', 'error', 'finished', 'idle']);
export type TicketChatState = z.infer<typeof ticketChatStateSchema>;

export const ticketLastSyncSchema = z.object({
  action: z.enum(['transition', 'link_pr', 'assign']),
  outcome: z.enum(['succeeded', 'skipped', 'failed']),
  message: z.string().nullable(),
  at: z.string(),
});
export type TicketLastSync = z.infer<typeof ticketLastSyncSchema>;

export const SNOOZE_MAX_DAYS = 90;

export const ticketSnoozeSchema = z.object({
  until: z.string(),
  rules: z.array(attentionRuleSchema),
});
export type TicketSnooze = z.infer<typeof ticketSnoozeSchema>;

export const snoozeTicketRequestSchema = z.object({
  until: z.iso.datetime({ offset: true }),
  rules: z.array(attentionRuleSchema).min(1).max(attentionRuleSchema.options.length),
});
export type SnoozeTicketRequest = z.infer<typeof snoozeTicketRequestSchema>;

export const ticketAgeSchema = z.object({ at: z.string(), label: z.string() });
export type TicketAge = z.infer<typeof ticketAgeSchema>;

export const inboxTicketSchema = ticketListItemSchema.extend({
  section: ticketSectionSchema,
  flags: z.array(attentionFlagSchema),
  reason: z.string(),
  tone: z.enum(['none', 'warn', 'error', 'running']),
  age: ticketAgeSchema.nullable(),
  chat: z
    .object({ conversationId: z.uuid(), title: z.string(), state: ticketChatStateSchema })
    .nullable(),
  pullRequest: pullRequestStatusSchema.nullable(),
  lastSync: ticketLastSyncSchema.nullable(),
  snooze: ticketSnoozeSchema.optional(),
});
export type InboxTicket = z.infer<typeof inboxTicketSchema>;

export const BRIEF_INTERVALS = [0, 15, 30, 60] as const;
const dayCount = z.number().int().min(1).max(30);

export const attentionSettingsSchema = z.object({
  idleDays: dayCount,
  dueDays: dayCount,
  reviewDays: dayCount,
  briefEnabled: z.boolean(),
  briefIntervalMinutes: z.literal(BRIEF_INTERVALS),
  connectHintDismissed: z.boolean(),
});
export type AttentionSettings = z.infer<typeof attentionSettingsSchema>;

export const DEFAULT_ATTENTION_SETTINGS: AttentionSettings = {
  idleDays: 2,
  dueDays: 2,
  reviewDays: 3,
  briefEnabled: true,
  briefIntervalMinutes: 30,
  connectHintDismissed: false,
};

export const updateAttentionSettingsSchema = attentionSettingsSchema
  .partial()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Change at least one setting.',
  });
export type UpdateAttentionSettings = z.infer<typeof updateAttentionSettingsSchema>;

export const ticketInboxSchema = z.object({
  tickets: z.array(inboxTicketSchema),
  errors: z.array(ticketSourceProblemSchema),
  sources: z.array(ticketSourceIdSchema),
  syncedAt: z.string(),
  settings: attentionSettingsSchema,
});
export type TicketInbox = z.infer<typeof ticketInboxSchema>;

export const ticketItemId = (source: string, key: string) => `ticket:${source}:${key}`;
