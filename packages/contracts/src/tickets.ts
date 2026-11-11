import { z } from 'zod';
import { ATTACHMENTS_PER_MESSAGE } from './attachments.ts';
import { ticketDevelopmentSchema } from './ticket-development.ts';
import { sessionTypeSchema, trackedTerminalProviderSchema } from './native-terminal.ts';
import { atlassianProductLive, atlassianProductsSchema } from './atlassian.ts';
import {
  serviceNowConnectionSchema,
  serviceNowInboxScopeSchema,
  serviceNowTypeLive,
  serviceNowInstanceSchema,
  serviceNowTypeIdSchema,
  serviceNowUsernameSchema,
} from './servicenow.ts';

export const TICKET_KEY_MAX_LENGTH = 64;
export const TICKET_SEARCH_MAX_LENGTH = 200;
export const TICKET_COMMENT_MAX_LENGTH = 10_000;
export const TICKET_START_NOTE_MAX_LENGTH = 4_000;
export const TICKET_START_LINKS_MAX = 10;
export const TICKET_START_FOLDERS_MAX = 5;

export const ticketSourceIdSchema = z.enum(['linear', 'jira', 'servicenow']);
export type TicketSourceId = z.infer<typeof ticketSourceIdSchema>;

export const ticketSourceNames: Record<TicketSourceId, string> = {
  linear: 'Linear',
  jira: 'Jira',
  servicenow: 'ServiceNow',
};

export const ticketStatusSchema = z.enum(['todo', 'in_progress', 'in_review', 'done']);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketStatusLabels: Record<TicketStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

export const ticketPersonSchema = z.object({ id: z.string(), name: z.string() });
export type TicketPerson = z.infer<typeof ticketPersonSchema>;

export const ticketReporterSchema = z.object({ name: z.string() });
export type TicketReporter = z.infer<typeof ticketReporterSchema>;

export const TICKET_PRIORITY_NONE = 0;

export const ticketSummarySchema = z.object({
  source: ticketSourceIdSchema,
  key: z.string(),
  title: z.string(),
  status: ticketStatusSchema,
  statusName: z.string(),
  url: z.string(),
  updatedAt: z.string(),
  project: z.string().nullable(),
  priority: z.string().nullable(),
  sprint: z.string().nullable(),
  priorityRank: z.number().int().min(0).max(4),
  assignedTo: ticketPersonSchema.nullable(),
  labels: z.array(z.string()),
  dueDate: z.string().nullable(),
  doneAt: z.string().nullable(),
  reporter: ticketReporterSchema.nullable(),
  createdAt: z.string().nullable(),
  group: z.string().nullable().optional(),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

export const ticketCommentVisibilitySchema = z.enum(['internal', 'customer']);
export type TicketCommentVisibility = z.infer<typeof ticketCommentVisibilitySchema>;

export const ticketCommentSchema = z.object({
  author: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
  visibility: ticketCommentVisibilitySchema.optional(),
});
export type TicketComment = z.infer<typeof ticketCommentSchema>;

export const ticketRefSchema = z.object({ title: z.string(), url: z.string() });
export type TicketRef = z.infer<typeof ticketRefSchema>;

export const ticketSubtaskSchema = z.object({
  key: z.string(),
  title: z.string(),
  status: ticketStatusSchema,
  statusName: z.string(),
  url: z.string().optional(),
});
export type TicketSubtask = z.infer<typeof ticketSubtaskSchema>;

export const ticketRelatedSchema = ticketSubtaskSchema.extend({ url: z.string() });
export type TicketRelated = z.infer<typeof ticketRelatedSchema>;

export const ticketRelationSchema = ticketRelatedSchema.extend({ relation: z.string() });
export type TicketRelation = z.infer<typeof ticketRelationSchema>;

export const ticketDetailSchema = ticketSummarySchema.extend({
  description: z.string(),
  assignee: z.string().nullable(),
  comments: z.array(ticketCommentSchema),
  links: z.array(ticketRefSchema),
  subtasks: z.array(ticketSubtaskSchema),
  subtasksMore: z.boolean().optional(),
  parent: ticketRelatedSchema.nullable().optional(),
  relations: z.array(ticketRelationSchema).optional(),
  attachments: z.array(z.object({ name: z.string(), bytes: z.number().int().min(0) })).optional(),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const ticketWorkSchema = z.object({
  taskId: z.uuid().nullable(),
  conversationId: z.uuid(),
  startedAt: z.string(),
  pullRequests: z.array(ticketRefSchema),
  prLinks: z.array(ticketRefSchema).optional(),
});
export type TicketWork = z.infer<typeof ticketWorkSchema>;

export const ticketListItemSchema = ticketSummarySchema.extend({
  work: z.array(ticketWorkSchema),
});
export type TicketListItem = z.infer<typeof ticketListItemSchema>;

export const ticketSourceErrorSchema = z.object({
  source: ticketSourceIdSchema,
  message: z.string(),
});

export const ticketListSchema = z.object({
  tickets: z.array(ticketListItemSchema),
  errors: z.array(ticketSourceErrorSchema),
});
export type TicketList = z.infer<typeof ticketListSchema>;

export const ticketViewSchema = z.object({
  ticket: ticketDetailSchema,
  work: z.array(ticketWorkSchema),
  development: ticketDevelopmentSchema.optional(),
});
export type TicketView = z.infer<typeof ticketViewSchema>;

export const ticketListQuerySchema = z.object({
  source: ticketSourceIdSchema.optional(),
  status: ticketStatusSchema.optional(),
  project: z.string().trim().min(1).max(TICKET_KEY_MAX_LENGTH).optional(),
  q: z.string().trim().max(TICKET_SEARCH_MAX_LENGTH).optional(),
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

export const ticketStatusMapSchema = z.record(
  z.string().trim().min(1).max(TICKET_KEY_MAX_LENGTH),
  z.partialRecord(ticketStatusSchema, z.string().trim().min(1).max(100)),
);
export type TicketStatusMap = z.infer<typeof ticketStatusMapSchema>;

export const ticketMoveSchema = z.enum(['in_progress', 'in_review', 'done']);
export type TicketMove = z.infer<typeof ticketMoveSchema>;

export const ticketMoveStatusesSchema = z.partialRecord(
  ticketMoveSchema,
  z.string().trim().min(1).max(100),
);
export type TicketMoveStatuses = z.infer<typeof ticketMoveStatusesSchema>;

export const ticketMoveOptionSchema = z.object({
  choices: z.array(z.string()),
  to: z.string().nullable(),
  problem: z.string().nullable(),
});
export type TicketMoveOption = z.infer<typeof ticketMoveOptionSchema>;

export const ticketMoveOptionsSchema = z.object({
  projects: z.array(
    z.object({
      project: z.string(),
      moves: z.record(ticketMoveSchema, ticketMoveOptionSchema),
    }),
  ),
});
export type TicketMoveOptions = z.infer<typeof ticketMoveOptionsSchema>;

export const ticketConnectionSchema = z.object({
  source: ticketSourceIdSchema,
  account: z.string(),
  siteUrl: z.string().nullable(),
  validatedAt: z.string(),
  keySaved: z.boolean(),
  moveOnShip: z.boolean(),
  moveOnMerge: z.boolean(),
  statusMap: ticketStatusMapSchema,
  moveStatuses: ticketMoveStatusesSchema,
  atlassian: atlassianProductsSchema.nullable().default(null),
  servicenow: serviceNowConnectionSchema.nullable().default(null),
});
export type TicketConnection = z.infer<typeof ticketConnectionSchema>;

export function ticketsFlowFrom(connection: TicketConnection): boolean {
  if (!connection.keySaved) return false;
  if (connection.source === 'servicenow') {
    return Object.values(connection.servicenow?.types ?? {}).some(serviceNowTypeLive);
  }
  return connection.source !== 'jira' || atlassianProductLive(connection.atlassian?.jira);
}

export const ticketConnectionsSchema = z.object({
  connections: z.array(ticketConnectionSchema),
});
export type TicketConnections = z.infer<typeof ticketConnectionsSchema>;

const JIRA_SITE =
  /^(?:https:\/\/[a-z0-9.-]+(?::\d{1,5})?|http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?)\/?$/i;

export const jiraSiteUrlSchema = z
  .string()
  .trim()
  .max(300)
  .regex(JIRA_SITE, 'Use your Atlassian site address, such as https://your-team.atlassian.net.')
  .transform((value) => value.replace(/\/$/, '').toLowerCase());

export const saveTicketConnectionRequestSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('linear'),
    apiKey: z.string().trim().min(20, 'Paste the full Linear API key.').max(400),
  }),
  z.object({
    source: z.literal('jira'),
    siteUrl: jiraSiteUrlSchema,
    email: z.email('Use the email you sign in to Atlassian with.').max(320),
    apiToken: z.string().trim().min(10, 'Paste the full API token.').max(400),
  }),
  z.discriminatedUnion('authKind', [
    z.object({
      source: z.literal('servicenow'),
      instanceUrl: serviceNowInstanceSchema,
      authKind: z.literal('basic'),
      username: serviceNowUsernameSchema,
      password: z.string().min(1, 'Type your password.').max(400),
    }),
    z.object({
      source: z.literal('servicenow'),
      instanceUrl: serviceNowInstanceSchema,
      authKind: z.literal('api_key'),
      username: serviceNowUsernameSchema,
      apiKey: z.string().trim().min(10, 'Paste the full API key.').max(400),
    }),
  ]),
]);
export type SaveTicketConnectionRequest = z.infer<typeof saveTicketConnectionRequestSchema>;

export const updateTicketSettingsRequestSchema = z
  .object({
    moveOnShip: z.boolean().optional(),
    moveOnMerge: z.boolean().optional(),
    statusMap: ticketStatusMapSchema.optional(),
    moveStatuses: ticketMoveStatusesSchema.optional(),
    jiraOn: z.boolean().optional(),
    confluenceOn: z.boolean().optional(),
    serviceNowTypes: z.partialRecord(serviceNowTypeIdSchema, z.boolean()).optional(),
    inboxScope: serviceNowInboxScopeSchema.optional(),
    recheck: z.literal(true).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Change at least one setting.',
  });
export type UpdateTicketSettingsRequest = z.infer<typeof updateTicketSettingsRequestSchema>;

export const ticketStartModeSchema = z.enum(['plan', 'build']);
export type TicketStartMode = z.infer<typeof ticketStartModeSchema>;

export const startTicketRequestSchema = z.object({
  conversationId: z.uuid(),
  sessionType: sessionTypeSchema.optional(),
  terminalProvider: trackedTerminalProviderSchema.optional(),
  messageId: z.uuid(),
  projectId: z.uuid().optional(),
  mode: ticketStartModeSchema.default('build'),
  moveToInProgress: z.boolean().default(true),
  note: z.string().trim().max(TICKET_START_NOTE_MAX_LENGTH).default(''),
  links: z
    .array(z.url({ protocol: /^https?$/ }).max(2000))
    .max(TICKET_START_LINKS_MAX)
    .default([]),
  attachmentIds: z.array(z.uuid()).max(ATTACHMENTS_PER_MESSAGE).default([]),
  folders: z.array(z.string().trim().min(1).max(4096)).max(TICKET_START_FOLDERS_MAX).default([]),
});
export type StartTicketRequest = z.infer<typeof startTicketRequestSchema>;

export const ticketSyncSchema = z.object({
  outcome: z.enum(['succeeded', 'skipped', 'failed']),
  message: z.string().nullable(),
});
export type TicketSync = z.infer<typeof ticketSyncSchema>;

export const startTicketResponseSchema = z.object({
  conversationId: z.uuid(),
  sessionType: sessionTypeSchema.optional(),
  taskId: z.uuid(),
  runId: z.uuid(),
  ticket: ticketSummarySchema,
  transition: ticketSyncSchema.nullable(),
});
export type StartTicketResponse = z.infer<typeof startTicketResponseSchema>;

export const transitionTicketRequestSchema = z.object({ status: ticketStatusSchema });

export const commentTicketRequestSchema = z.object({
  body: z.string().trim().min(1).max(TICKET_COMMENT_MAX_LENGTH),
  visibility: z.literal('customer').optional(),
});
export type CommentTicketRequest = z.infer<typeof commentTicketRequestSchema>;
