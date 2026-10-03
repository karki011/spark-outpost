import { z } from 'zod';
import { involvementLevelSchema } from './involvement-levels.ts';
import { providerIdSchema } from './provider-ids.ts';
import {
  teammateFaceSchema,
  teammateInstructionsSchema,
  teammateNameSchema,
  teammateRoleSchema,
} from './teammates.ts';
import { ticketSourceIdSchema, ticketStatusSchema } from './tickets.ts';

export const SPARK_ACTION_KIND = 'spark_action' as const;

export const SPARK_ACTION_OPTION = { confirm: 'confirm', decline: 'decline' } as const;

export const ticketPriorityNameSchema = z.enum(['urgent', 'high', 'medium', 'low']);
export type TicketPriorityName = z.infer<typeof ticketPriorityNameSchema>;

export const SPARK_TITLE_MAX = 250;
export const SPARK_TEXT_MAX = 20_000;
export const SPARK_LABELS_MAX = 20;

const title = z.string().trim().min(1).max(SPARK_TITLE_MAX);
const text = z.string().max(SPARK_TEXT_MAX);
const labels = z.array(z.string().trim().min(1).max(100)).max(SPARK_LABELS_MAX);

const ticketRefSchema = z.object({
  source: ticketSourceIdSchema,
  key: z.string(),
  title: z.string(),
  url: z.string().nullable(),
});

export const createTicketActionSchema = z.object({
  action: z.literal('create_ticket'),
  source: ticketSourceIdSchema,
  project: z.string().trim().min(1).max(100),
  title,
  description: text,
  type: z.string().trim().max(60).nullable(),
  priority: ticketPriorityNameSchema.nullable(),
  labels,
  assignToMe: z.boolean(),
});

export const commentTicketActionSchema = z.object({
  action: z.literal('comment_ticket'),
  ticket: ticketRefSchema,
  body: z.string().trim().min(1).max(SPARK_TEXT_MAX),
});

export const transitionTicketActionSchema = z.object({
  action: z.literal('transition_ticket'),
  ticket: ticketRefSchema,
  from: z.string(),
  status: ticketStatusSchema,
});

export const assignTicketActionSchema = z.object({
  action: z.literal('assign_ticket'),
  ticket: ticketRefSchema,
  currentAssignee: z.string().nullable(),
  currentAssigneeId: z.string().nullable(),
  to: z.enum(['me', 'nobody']),
});

export const openPullRequestActionSchema = z.object({
  action: z.literal('open_pr'),
  taskId: z.uuid(),
  title,
  body: text,
  branch: z.string(),
  base: z.string().nullable(),
  repo: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), change: z.string() })).max(200),
  moreFiles: z.number().int().nonnegative(),
});

export const PR_PUSH_ITEM = 'push';

export const prFollowUpActionSchema = z.object({
  action: z.literal('pr_follow_up'),
  watchId: z.uuid(),
  repo: z.string(),
  number: z.number().int().positive(),
  url: z.string(),
  branch: z.string(),
  push: z
    .object({ files: z.array(z.string()).max(200), moreFiles: z.number().int().nonnegative() })
    .nullable(),
  items: z
    .array(
      z.object({
        id: z.uuid(),
        label: z.string(),
        author: z.string(),
        where: z.string(),
        what: z.string(),
        reply: z.string().nullable(),
      }),
    )
    .max(100),
  skip: z.array(z.string().max(60)).max(101).default([]),
});
export type PrFollowUpAction = z.infer<typeof prFollowUpActionSchema>;

export const prFollowUpRoundActionSchema = z.object({
  action: z.literal('pr_follow_up_round'),
  watchId: z.uuid(),
  repo: z.string(),
  number: z.number().int().positive(),
  items: z
    .array(z.object({ label: z.string(), author: z.string(), what: z.string() }))
    .min(1)
    .max(100),
});

const teammateFieldsShape = {
  name: teammateNameSchema,
  role: teammateRoleSchema,
  face: teammateFaceSchema,
  provider: providerIdSchema.nullable(),
  model: z.string().nullable(),
  agentMode: z.string().nullable(),
  level: involvementLevelSchema.nullable(),
  instructions: teammateInstructionsSchema,
  projects: z.array(z.object({ id: z.uuid(), name: z.string() })).max(8),
};

export const createTeammateActionSchema = z.object({
  action: z.literal('create_teammate'),
  ...teammateFieldsShape,
});

export const updateTeammateActionSchema = z.object({
  action: z.literal('update_teammate'),
  teammateId: z.uuid(),
  ...teammateFieldsShape,
  changed: z.array(z.string()).max(20),
});

export const sparkActionSchema = z.discriminatedUnion('action', [
  createTicketActionSchema,
  commentTicketActionSchema,
  transitionTicketActionSchema,
  assignTicketActionSchema,
  openPullRequestActionSchema,
  prFollowUpActionSchema,
  prFollowUpRoundActionSchema,
  createTeammateActionSchema,
  updateTeammateActionSchema,
]);
export type SparkAction = z.infer<typeof sparkActionSchema>;
export type SparkActionName = SparkAction['action'];

export const sparkActionEditsSchema = z
  .object({
    title,
    description: text,
    body: text,
    type: z.string().trim().max(60).nullable(),
    priority: ticketPriorityNameSchema.nullable(),
    labels,
    status: ticketStatusSchema,
    skip: z.array(z.string().max(60)).max(101),
  })
  .partial()
  .strict();
export type SparkActionEdits = z.infer<typeof sparkActionEditsSchema>;

const EDITABLE: Record<SparkActionName, readonly (keyof SparkActionEdits)[]> = {
  create_ticket: ['title', 'description', 'type', 'priority', 'labels'],
  comment_ticket: ['body'],
  transition_ticket: ['status'],
  assign_ticket: [],
  open_pr: ['title', 'body'],
  pr_follow_up: ['skip'],
  pr_follow_up_round: [],
  create_teammate: [],
  update_teammate: [],
};

export function editableFields(action: SparkActionName): readonly (keyof SparkActionEdits)[] {
  return EDITABLE[action];
}

export function applySparkEdits(action: SparkAction, edits: SparkActionEdits | null): SparkAction {
  if (!edits) return action;
  const allowed = EDITABLE[action.action];
  const picked = Object.fromEntries(
    Object.entries(edits).filter(([field]) => allowed.includes(field as keyof SparkActionEdits)),
  );
  return sparkActionSchema.parse({ ...action, ...picked });
}

export const sparkActionLabels: Record<SparkActionName, { question: string; confirm: string }> = {
  create_ticket: { question: 'Create this ticket?', confirm: 'Create ticket' },
  comment_ticket: { question: 'Post this comment?', confirm: 'Post comment' },
  transition_ticket: { question: 'Move this ticket?', confirm: 'Move ticket' },
  assign_ticket: { question: 'Change who owns this ticket?', confirm: 'Assign' },
  open_pr: { question: 'Open a pull request?', confirm: 'Open PR' },
  pr_follow_up: { question: 'Address PR feedback?', confirm: 'Push and reply' },
  pr_follow_up_round: { question: 'Start a PR follow-up round?', confirm: 'Start round' },
  create_teammate: { question: 'Add this Spark?', confirm: 'Add Spark' },
  update_teammate: { question: 'Change this Spark?', confirm: 'Save changes' },
};
