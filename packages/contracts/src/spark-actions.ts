import { z } from 'zod';
import { involvementLevelSchema } from './involvement-levels.ts';
import { providerIdSchema } from './provider-ids.ts';
import {
  teammateFaceSchema,
  teammateInstructionsSchema,
  teammateNameSchema,
  teammateRoleSchema,
} from './teammates.ts';
import {
  addMcpServerActionSchema,
  removeMcpServerActionSchema,
  switchMcpServerActionSchema,
  updateMcpServerActionSchema,
} from './spark-mcp-actions.ts';
import { SLACK_POST_TEXT_MAX, slackChannelIdSchema } from './slack.ts';
import {
  calendarEditActionSchema,
  calendarEditQuestion,
  calendarReadActionSchema,
} from './calendar-actions.ts';
import { ticketSourceIdSchema, ticketStatusSchema } from './tickets.ts';
import {
  atlassianActionLabels,
  atlassianActionSchemas,
  atlassianQuestion,
} from './atlassian-actions.ts';
import { browserActionLabels, browserActionSchemas, browserQuestion } from './browser-actions.ts';
import { startOutpostActionSchema, startOutpostLabels } from './outpost-start-action.ts';
import { askSparkActionSchema, askSparkLabels } from './ask-spark-action.ts';
import { publishArtifactActionSchema, publishArtifactLabels } from './artifact-pages.ts';

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
  to: z.string().optional(),
  choices: z.array(z.string()).optional(),
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
  faceAuto: z.boolean().default(false),
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

const macApp = {
  app: z.string().max(200),
  bundleId: z.string().max(200),
};
export const macUseAppActionSchema = z.object({
  action: z.literal('mac_use_app'),
  ...macApp,
  first: z.string().max(300),
});
export type MacUseAppAction = z.infer<typeof macUseAppActionSchema>;
export const macActActionSchema = z.object({
  action: z.literal('mac_act'),
  ...macApp,
  did: z.string().max(300),
});
export type MacActAction = z.infer<typeof macActActionSchema>;
export const macPressActionSchema = z.object({
  action: z.literal('mac_press'),
  ...macApp,
  what: z.string().max(300),
  window: z.string().max(300).nullable(),
});
export type MacPressAction = z.infer<typeof macPressActionSchema>;
export type MacAction = MacUseAppAction | MacActAction | MacPressAction;

const MAC_ACTIONS: ReadonlySet<string> = new Set(['mac_use_app', 'mac_act', 'mac_press']);

export function isMacAction(action: string): action is MacAction['action'] {
  return MAC_ACTIONS.has(action);
}
export const postSlackActionSchema = z.object({
  action: z.literal('post_slack'),
  asYou: z.boolean().optional(),
  channel: z.object({ id: slackChannelIdSchema, name: z.string() }),
  threadTs: z.string().nullable(),
  permalink: z.string().nullable(),
  body: z.string().trim().min(1).max(SLACK_POST_TEXT_MAX),
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
  addMcpServerActionSchema,
  updateMcpServerActionSchema,
  switchMcpServerActionSchema,
  removeMcpServerActionSchema,
  ...browserActionSchemas,
  macUseAppActionSchema,
  macActActionSchema,
  macPressActionSchema,
  postSlackActionSchema,
  calendarReadActionSchema,
  calendarEditActionSchema,
  ...atlassianActionSchemas,
  startOutpostActionSchema,
  askSparkActionSchema,
  publishArtifactActionSchema,
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
    to: z.string().trim().min(1).max(100),
    skip: z.array(z.string().max(60)).max(101),
  })
  .partial()
  .strict();
export type SparkActionEdits = z.infer<typeof sparkActionEditsSchema>;

const EDITABLE: Record<SparkActionName, readonly (keyof SparkActionEdits)[]> = {
  create_ticket: ['title', 'description', 'type', 'priority', 'labels'],
  comment_ticket: ['body'],
  transition_ticket: ['status', 'to'],
  assign_ticket: [],
  open_pr: ['title', 'body'],
  pr_follow_up: ['skip'],
  pr_follow_up_round: [],
  create_teammate: [],
  update_teammate: [],
  add_mcp_server: [],
  update_mcp_server: [],
  switch_mcp_server: [],
  remove_mcp_server: [],
  read_page: [],
  open_page: [],
  act_page: [],
  browser_sign_in: [],
  browser_handoff: [],
  mac_use_app: [],
  mac_act: [],
  mac_press: [],
  post_slack: ['body'],
  calendar_read: [],
  calendar_edit: [],
  atlassian_read: [],
  jira_edit: [],
  confluence_edit: [],
  start_outpost: [],
  ask_spark: [],
  publish_artifact: [],
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

interface SparkActionLabel {
  question: string;
  confirm: string;
  doing: string;
}

export const sparkActionLabels: Record<SparkActionName, SparkActionLabel> = {
  create_ticket: {
    question: 'Create this ticket?',
    confirm: 'Create ticket',
    doing: 'Creating the ticket…',
  },
  comment_ticket: {
    question: 'Post this comment?',
    confirm: 'Post comment',
    doing: 'Posting the comment…',
  },
  transition_ticket: {
    question: 'Move this ticket?',
    confirm: 'Move ticket',
    doing: 'Moving the ticket…',
  },
  assign_ticket: {
    question: 'Change who owns this ticket?',
    confirm: 'Assign',
    doing: 'Changing who owns the ticket…',
  },
  open_pr: {
    question: 'Open a pull request?',
    confirm: 'Open PR',
    doing: 'Opening the pull request…',
  },
  pr_follow_up: {
    question: 'Address PR feedback?',
    confirm: 'Push and reply',
    doing: 'Pushing the fixes and replying…',
  },
  pr_follow_up_round: {
    question: 'Start a PR follow-up round?',
    confirm: 'Start round',
    doing: 'Starting the follow-up round…',
  },
  create_teammate: {
    question: 'Add this Spark?',
    confirm: 'Add Spark',
    doing: 'Adding the Spark…',
  },
  update_teammate: {
    question: 'Change this Spark?',
    confirm: 'Save changes',
    doing: 'Saving the Spark…',
  },
  add_mcp_server: {
    question: 'Add this MCP server?',
    confirm: 'Add server',
    doing: 'Adding the MCP server…',
  },
  update_mcp_server: {
    question: 'Change this MCP server?',
    confirm: 'Save changes',
    doing: 'Saving the MCP server…',
  },
  switch_mcp_server: {
    question: 'Switch this MCP server?',
    confirm: 'Switch',
    doing: 'Switching the MCP server…',
  },
  remove_mcp_server: {
    question: 'Remove this MCP server?',
    confirm: 'Remove server',
    doing: 'Removing the MCP server…',
  },
  mac_use_app: {
    question: 'Let the agent use this app in this chat?',
    confirm: 'Allow for this chat',
    doing: 'Allowing the app…',
  },
  mac_act: {
    question: 'Let the agent press buttons and menus in this app?',
    confirm: 'Allow for this chat',
    doing: 'Allowing the app…',
  },
  mac_press: {
    question: 'Press this in another app?',
    confirm: 'Press it',
    doing: 'Allowing the press…',
  },
  post_slack: {
    question: 'Post this to Slack?',
    confirm: 'Post to Slack',
    doing: 'Posting to Slack…',
  },
  calendar_read: {
    question: 'Let the agent read your calendar?',
    confirm: 'Allow for this chat',
    doing: 'Allowing the calendar…',
  },
  calendar_edit: {
    question: 'Change this event?',
    confirm: 'Save change',
    doing: 'Changing the event…',
  },
  ...atlassianActionLabels,
  ...browserActionLabels,
  ...startOutpostLabels,
  ...askSparkLabels,
  ...publishArtifactLabels,
};

const SLACK_POST_AS_YOU_QUESTION = 'Post this to Slack as you?';

export function sparkActionQuestion(action: SparkAction): string {
  const browser = browserQuestion(action);
  if (browser) return browser;
  if (action.action === 'post_slack' && action.asYou) return SLACK_POST_AS_YOU_QUESTION;
  if (action.action === 'mac_use_app') return `Let the agent use ${action.app} in this chat?`;
  if (action.action === 'mac_act') return `Let the agent press buttons and menus in ${action.app}?`;
  if (action.action === 'mac_press') return `Press ${action.what} in ${action.app}?`;
  if (action.action === 'calendar_edit') return calendarEditQuestion(action);
  return atlassianQuestion(action) ?? sparkActionLabels[action.action].question;
}

export const sparkResultStateSchema = z.enum(['waiting', 'running', 'done', 'failed', 'unknown']);
export type SparkResultState = z.infer<typeof sparkResultStateSchema>;

export const sparkResultSchema = z.object({
  state: sparkResultStateSchema,
  message: z.string().max(2000).nullable(),
  url: z.string().max(2000).nullable(),
  output: z.record(z.string(), z.unknown()).optional(),
});
export type SparkResult = z.infer<typeof sparkResultSchema>;

export function sparkResultFinished(result: SparkResult | undefined): boolean {
  return result?.state === 'done' || result?.state === 'failed' || result?.state === 'unknown';
}

const REPEATABLE: ReadonlySet<SparkActionName> = new Set([
  'pr_follow_up_round',
  'transition_ticket',
  'assign_ticket',
  'update_teammate',
  'update_mcp_server',
  'switch_mcp_server',
  'remove_mcp_server',
  'read_page',
  'open_page',
  'act_page',
  'browser_sign_in',
  'mac_use_app',
  'mac_act',
  'mac_press',
  'calendar_read',
]);

export function sparkRetryAllowed(action: SparkAction, result: SparkResult | undefined): boolean {
  if (result?.state === 'failed') return true;
  return result?.state === 'unknown' && REPEATABLE.has(action.action);
}
