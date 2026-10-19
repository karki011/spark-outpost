import { z } from 'zod';
import {
  ATLASSIAN_BODY_MAX,
  atlassianProductIdSchema,
  atlassianProductNames,
  CONFLUENCE_TITLE_MAX,
} from './atlassian.ts';

export const ATLASSIAN_CARD_TEXT_MAX = 4_000;

const cardText = z.string().max(ATLASSIAN_CARD_TEXT_MAX);

export const atlassianReadActionSchema = z.object({
  action: z.literal('atlassian_read'),
  product: atlassianProductIdSchema,
  what: z.string().max(300),
});
export type AtlassianReadAction = z.infer<typeof atlassianReadActionSchema>;

export const jiraEditOpSchema = z.enum(['update', 'edit_comment', 'delete_comment', 'delete']);
export type JiraEditOp = z.infer<typeof jiraEditOpSchema>;

const jiraIssueFactsSchema = z.object({
  summary: z.string().max(1_000),
  description: cardText,
  labels: z.array(z.string().max(255)).max(50),
  priority: z.string().max(100).nullable(),
});
export type JiraIssueFacts = z.infer<typeof jiraIssueFactsSchema>;

export const jiraChangesSchema = z
  .object({
    summary: z.string().trim().min(1).max(255),
    description: z.string().max(ATLASSIAN_BODY_MAX),
    labels: z.array(z.string().trim().min(1).max(100)).max(50),
    priority: z.string().trim().min(1).max(100),
  })
  .partial();
export type JiraChanges = z.infer<typeof jiraChangesSchema>;

export const jiraEditActionSchema = z.object({
  action: z.literal('jira_edit'),
  op: jiraEditOpSchema,
  ticket: z.object({ key: z.string().max(64), title: z.string().max(1_000), url: z.string() }),
  updated: z.string().max(60).nullable(),
  changes: jiraChangesSchema,
  before: jiraIssueFactsSchema.nullable(),
  after: jiraIssueFactsSchema.nullable(),
  comment: z
    .object({
      id: z.string().max(40),
      before: cardText,
      after: z.string().max(ATLASSIAN_BODY_MAX).nullable(),
      updatedAt: z.string().max(60).nullable(),
    })
    .nullable(),
  subtasks: z.array(z.string().max(64)).max(200),
});
export type JiraEditAction = z.infer<typeof jiraEditActionSchema>;

export const confluenceEditOpSchema = z.enum(['create', 'update', 'comment', 'delete']);
export type ConfluenceEditOp = z.infer<typeof confluenceEditOpSchema>;

const pageFactsSchema = z.object({ title: z.string().max(CONFLUENCE_TITLE_MAX), text: cardText });
export type ConfluencePageFacts = z.infer<typeof pageFactsSchema>;

export const confluenceEditActionSchema = z.object({
  action: z.literal('confluence_edit'),
  op: confluenceEditOpSchema,
  page: z.object({
    id: z.string().max(20).nullable(),
    title: z.string().max(CONFLUENCE_TITLE_MAX),
    url: z.string().nullable(),
    version: z.number().int().positive().nullable(),
    spaceId: z.string().max(40).nullable(),
    space: z.string().max(300).nullable(),
    parentId: z.string().max(20).nullable(),
  }),
  body: z.string().max(ATLASSIAN_BODY_MAX).nullable(),
  before: pageFactsSchema.nullable(),
  after: pageFactsSchema.nullable(),
});
export type ConfluenceEditAction = z.infer<typeof confluenceEditActionSchema>;

export type AtlassianAction = AtlassianReadAction | JiraEditAction | ConfluenceEditAction;

const ATLASSIAN_ACTIONS: ReadonlySet<string> = new Set([
  'atlassian_read',
  'jira_edit',
  'confluence_edit',
]);

export function isAtlassianAction(action: string): action is AtlassianAction['action'] {
  return ATLASSIAN_ACTIONS.has(action);
}

const JIRA_QUESTIONS: Record<JiraEditOp, { question: string; confirm: string }> = {
  update: { question: 'Change this ticket?', confirm: 'Save change' },
  edit_comment: { question: 'Edit this comment?', confirm: 'Save comment' },
  delete_comment: { question: 'Delete this comment?', confirm: 'Delete comment' },
  delete: { question: 'Delete this ticket?', confirm: 'Delete ticket' },
};

const CONFLUENCE_QUESTIONS: Record<ConfluenceEditOp, { question: string; confirm: string }> = {
  create: { question: 'Create this Confluence page?', confirm: 'Create page' },
  update: { question: 'Change this Confluence page?', confirm: 'Save page' },
  comment: { question: 'Post this comment on Confluence?', confirm: 'Post comment' },
  delete: { question: 'Move this page to the Confluence trash?', confirm: 'Move to trash' },
};

export const atlassianActionSchemas = [
  atlassianReadActionSchema,
  jiraEditActionSchema,
  confluenceEditActionSchema,
] as const;

export function atlassianQuestion(candidate: { action: string }): string | null {
  if (!isAtlassianAction(candidate.action)) return null;
  const action = candidate as AtlassianAction;
  if (action.action === 'atlassian_read') {
    return `Let the agent read ${atlassianProductNames[action.product]}?`;
  }
  if (action.action === 'jira_edit') return JIRA_QUESTIONS[action.op].question;
  return CONFLUENCE_QUESTIONS[action.op].question;
}

export function atlassianConfirm(action: AtlassianAction): string {
  if (action.action === 'atlassian_read') return 'Allow for this chat';
  if (action.action === 'jira_edit') return JIRA_QUESTIONS[action.op].confirm;
  return CONFLUENCE_QUESTIONS[action.op].confirm;
}

export function atlassianCardSubject(action: AtlassianAction): string {
  if (action.action === 'atlassian_read') return '';
  if (action.action === 'jira_edit') return `${action.ticket.key} ${action.ticket.title}`;
  return action.page.title;
}

export function atlassianDeletes(action: AtlassianAction): boolean {
  if (action.action === 'jira_edit')
    return action.op === 'delete' || action.op === 'delete_comment';
  return action.action === 'confluence_edit' && action.op === 'delete';
}

export const atlassianActionLabels: Record<
  AtlassianAction['action'],
  { question: string; confirm: string; doing: string }
> = {
  atlassian_read: {
    question: 'Let the agent read Jira or Confluence?',
    confirm: 'Allow for this chat',
    doing: 'Allowing Atlassian…',
  },
  jira_edit: { question: 'Change this ticket?', confirm: 'Save change', doing: 'Changing Jira…' },
  confluence_edit: {
    question: 'Change this Confluence page?',
    confirm: 'Save page',
    doing: 'Changing Confluence…',
  },
};

export function atlassianAuditFacts(action: AtlassianAction): Record<string, unknown> {
  if (action.action === 'atlassian_read') {
    return { action: action.action, product: action.product, what: action.what };
  }
  if (action.action === 'jira_edit') {
    return {
      action: action.action,
      op: action.op,
      key: action.ticket.key,
      changed: Object.keys(action.changes).toSorted(),
      ...(action.comment ? { commentId: action.comment.id } : {}),
      ...(action.subtasks.length > 0 ? { subtasks: action.subtasks.length } : {}),
    };
  }
  return {
    action: action.action,
    op: action.op,
    pageId: action.page.id,
    spaceId: action.page.spaceId,
    version: action.page.version,
    title: action.page.title,
    bodyLength: action.body?.length ?? 0,
  };
}
