import { z } from 'zod';
import {
  workflowControlActionSchema,
  workflowControlLabels,
  workflowControlQuestion,
} from './workflow-control-action.ts';
import {
  createTeammateActionSchema,
  deleteTeammateActionSchema,
  teammateActionLabels,
  teammateActionQuestion,
  updateTeammateActionSchema,
} from './teammate-actions.ts';
import {
  addMcpServerActionSchema,
  removeMcpServerActionSchema,
  switchMcpServerActionSchema,
  updateMcpServerActionSchema,
} from './spark-mcp-actions.ts';
import { saveMapNoteActionSchema } from './map-notes.ts';
import { prepareSetupActionSchema } from './setup-drafts.ts';
import { SLACK_POST_TEXT_MAX, slackChannelIdSchema } from './slack.ts';
import { rulesEditActionSchema, rulesEditLabels, rulesEditQuestion } from './spark-rules-edit.ts';
import { crewEditActionSchema, crewEditLabels, crewEditQuestion } from './crew-edit.ts';
import {
  pluginsEditActionSchema,
  pluginsEditLabels,
  pluginsEditQuestion,
} from './spark-plugins-edit.ts';
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
import { jiraTeamChoiceSchema } from './jira-actions.ts';
import {
  serviceNowActionLabels,
  serviceNowActionSchemas,
  serviceNowQuestion,
} from './servicenow-actions.ts';
import { browserActionLabels, browserActionSchemas, browserQuestion } from './browser-actions.ts';
import {
  sendToChatActionSchema,
  sendToChatLabels,
  sendToChatQuestion,
} from './send-to-chat-action.ts';
import {
  applySubChatEdits,
  startSubChatsActionSchema,
  stopSubChatActionSchema,
  subChatActionLabels,
  subChatActionQuestion,
  subChatEditSchema,
} from './start-sub-chats-action.ts';
import { askSparkActionSchema, askSparkLabels } from './ask-spark-action.ts';
import { publishArtifactActionSchema, publishArtifactLabels } from './artifact-pages.ts';
import { linkRepoActionSchema, linkRepoLabels, linkRepoQuestion } from './repos-folders.ts';
import {
  cloneRepoActionSchema,
  githubReadActionSchema,
  githubRepoLabels,
  githubRepoQuestion,
} from './github-repos.ts';

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
  parent: z.string().trim().min(1).max(64).nullable().default(null),
  team: jiraTeamChoiceSchema.nullable().default(null),
  fields: z
    .array(
      z.object({
        id: z.string().max(100),
        name: z.string().max(200),
        value: z.unknown(),
        shown: z.string().max(300),
      }),
    )
    .max(50)
    .default([]),
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
  deleteTeammateActionSchema,
  workflowControlActionSchema,
  addMcpServerActionSchema,
  updateMcpServerActionSchema,
  switchMcpServerActionSchema,
  removeMcpServerActionSchema,
  prepareSetupActionSchema,
  saveMapNoteActionSchema,
  ...browserActionSchemas,
  macUseAppActionSchema,
  macActActionSchema,
  macPressActionSchema,
  postSlackActionSchema,
  calendarReadActionSchema,
  calendarEditActionSchema,
  ...atlassianActionSchemas,
  ...serviceNowActionSchemas,
  sendToChatActionSchema,
  startSubChatsActionSchema,
  stopSubChatActionSchema,
  askSparkActionSchema,
  publishArtifactActionSchema,
  rulesEditActionSchema,
  pluginsEditActionSchema,
  crewEditActionSchema,
  linkRepoActionSchema,
  githubReadActionSchema,
  cloneRepoActionSchema,
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
    subChats: z.array(subChatEditSchema),
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
  delete_teammate: [],
  add_mcp_server: [],
  update_mcp_server: [],
  switch_mcp_server: [],
  remove_mcp_server: [],
  prepare_setup: [],
  save_map_note: [],
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
  servicenow_read: [],
  servicenow_edit: [],
  send_to_chat: [],
  start_sub_chats: ['subChats'],
  stop_sub_chat: [],
  ask_spark: [],
  publish_artifact: [],
  rules_edit: [],
  plugins_edit: [],
  crew_edit: [],
  workflow_control: [],
  link_repo: [],
  github_read: [],
  clone_repo: [],
};

export function editableFields(action: SparkActionName): readonly (keyof SparkActionEdits)[] {
  return EDITABLE[action];
}

export function applySparkEdits(action: SparkAction, edits: SparkActionEdits | null): SparkAction {
  if (!edits) return action;
  if (action.action === 'start_sub_chats') return applySubChatEdits(action, edits.subChats ?? []);
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
  ...teammateActionLabels,
  prepare_setup: {
    question: 'Prepare this connection?',
    confirm: 'Prepare',
    doing: 'Preparing the connection…',
  },
  save_map_note: {
    question: 'Save this Map explanation?',
    confirm: 'Save',
    doing: 'Saving the explanation…',
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
  ...serviceNowActionLabels,
  ...browserActionLabels,
  ...sendToChatLabels,
  ...subChatActionLabels,
  ...askSparkLabels,
  ...publishArtifactLabels,
  ...rulesEditLabels,
  ...pluginsEditLabels,
  ...crewEditLabels,
  ...workflowControlLabels,
  ...linkRepoLabels,
  ...githubRepoLabels,
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
  if (action.action === 'rules_edit') return rulesEditQuestion(action);
  if (action.action === 'plugins_edit') return pluginsEditQuestion(action);
  if (action.action === 'crew_edit') return crewEditQuestion(action);
  if (action.action === 'workflow_control') return workflowControlQuestion(action);
  const teammate = teammateActionQuestion(action);
  if (teammate) return teammate;
  if (action.action === 'link_repo') return linkRepoQuestion(action);
  if (action.action === 'send_to_chat') return sendToChatQuestion(action);
  if (action.action === 'start_sub_chats' || action.action === 'stop_sub_chat') {
    return subChatActionQuestion(action);
  }
  return (
    atlassianQuestion(action) ??
    serviceNowQuestion(action) ??
    githubRepoQuestion(action) ??
    sparkActionLabels[action.action].question
  );
}
