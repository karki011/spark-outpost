import { z } from 'zod';
import {
  ATLASSIAN_BODY_MAX,
  atlassianProductIdSchema,
  atlassianProductNames,
  CONFLUENCE_TITLE_MAX,
} from './atlassian.ts';
import {
  ATLASSIAN_CARD_TEXT_MAX,
  isJiraDelete,
  JIRA_QUESTIONS,
  jiraEditActionSchema,
  type JiraEditAction,
} from './jira-actions.ts';

const cardText = z.string().max(ATLASSIAN_CARD_TEXT_MAX);

export const atlassianReadActionSchema = z.object({
  action: z.literal('atlassian_read'),
  product: atlassianProductIdSchema,
  what: z.string().max(300),
});
export type AtlassianReadAction = z.infer<typeof atlassianReadActionSchema>;

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
  if (action.action === 'jira_edit') return isJiraDelete(action.op);
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
      changed: [
        ...new Set([...Object.keys(action.changes), ...action.rows.map((row) => row.label)]),
      ].toSorted(),
      ...(action.targets.length > 0 ? { targets: action.targets.length } : {}),
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
