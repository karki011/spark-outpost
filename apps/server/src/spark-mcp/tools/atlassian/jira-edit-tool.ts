import { z } from 'zod';
import {
  ATLASSIAN_BODY_MAX,
  ATLASSIAN_CARD_TEXT_MAX,
  atlassianConfirm,
  jiraEditOpSchema,
  ticketKeySchema,
  type JiraChanges,
  type JiraEditAction,
  type JiraEditOp,
  type JiraIssueFacts,
} from '@spark-outpost/contracts';
import type { JiraFacts } from '../../../atlassian/jira-edits.ts';
import { openAtlassian, type AtlassianSession } from '../../../atlassian/session.ts';
import { ACTION_NOTE } from '../../actions/action-note.ts';
import { proposeAction } from '../../actions/confirm.ts';
import { ticketDepsFor } from '../../deps.ts';
import { SparkToolError, sparkTool, type SparkToolContext } from '../../tool.ts';

interface EditArgs {
  action: JiraEditOp;
  key: string;
  summary?: string | undefined;
  description?: string | undefined;
  labels?: string[] | undefined;
  priority?: string | undefined;
  commentId?: string | undefined;
  body?: string | undefined;
  withSubtasks: boolean;
}

const card = (text: string) => text.slice(0, ATLASSIAN_CARD_TEXT_MAX);

export function issueFacts(
  facts: Pick<JiraFacts, 'summary' | 'description' | 'labels' | 'priority'>,
): JiraIssueFacts {
  return {
    summary: facts.summary,
    description: card(facts.description),
    labels: facts.labels,
    priority: facts.priority,
  };
}

function changesOf(args: EditArgs): JiraChanges {
  const changes: JiraChanges = {};
  if (args.summary !== undefined) changes.summary = args.summary;
  if (args.description !== undefined) changes.description = args.description;
  if (args.labels !== undefined) {
    changes.labels = args.labels.map((label) => label.replace(/\s+/g, '-'));
  }
  if (args.priority !== undefined) changes.priority = args.priority;
  return changes;
}

function base(op: JiraEditOp, facts: JiraFacts, session: AtlassianSession): JiraEditAction {
  return {
    action: 'jira_edit',
    op,
    ticket: { key: facts.key, title: facts.summary, url: session.jira.browse(facts.key) },
    updated: facts.updated,
    changes: {},
    before: null,
    after: null,
    comment: null,
    subtasks: [],
  };
}

async function ownComment(session: AtlassianSession, key: string, commentId: string | undefined) {
  if (!commentId) throw new SparkToolError('Pass commentId from spark_jira read.');
  const comment = await session.jira.comment(key, commentId);
  if (!session.accountId || comment.authorId !== session.accountId) {
    throw new SparkToolError(
      `Comment ${commentId} on ${key} was written by ${comment.author ?? 'someone else'}. Spark edits and deletes only the user's own comments.`,
    );
  }
  return comment;
}

async function plan(session: AtlassianSession, args: EditArgs): Promise<JiraEditAction> {
  const facts = await session.jira.facts(args.key);
  const action = base(args.action, facts, session);
  if (args.action === 'update') {
    const changes = changesOf(args);
    if (Object.keys(changes).length === 0) {
      throw new SparkToolError('Pass at least one of summary, description, labels or priority.');
    }
    return {
      ...action,
      changes,
      before: issueFacts(facts),
      after: issueFacts({
        summary: changes.summary ?? facts.summary,
        description: changes.description ?? facts.description,
        labels: changes.labels ?? facts.labels,
        priority: changes.priority ?? facts.priority,
      }),
    };
  }
  if (args.action === 'delete') {
    if (facts.subtasks.length > 0 && !args.withSubtasks) {
      throw new SparkToolError(
        `${facts.key} has subtasks (${facts.subtasks.join(', ')}). Nothing was deleted. Pass withSubtasks true to delete them with it.`,
      );
    }
    return { ...action, before: issueFacts(facts), subtasks: facts.subtasks };
  }
  const comment = await ownComment(session, facts.key, args.commentId);
  if (args.action === 'edit_comment' && !args.body) {
    throw new SparkToolError('Pass body with the new comment text.');
  }
  return {
    ...action,
    comment: {
      id: comment.id,
      before: card(comment.body),
      after: args.action === 'edit_comment' ? args.body! : null,
      updatedAt: comment.updatedAt,
    },
  };
}

async function edit(context: SparkToolContext, args: EditArgs) {
  const session = await openAtlassian(ticketDepsFor(context.deps, context.scope), 'jira');
  const action = await plan(session, args);
  return proposeAction(context, action, { confirmName: atlassianConfirm(action) });
}

export const jiraEditTool = sparkTool({
  name: 'spark_jira_edit',
  needs: 'jira',
  acts: true,
  title: 'Change Jira',
  description: `Changes a Jira issue: update sets summary, description (plain text or Markdown), labels (replaces them) or priority by name; edit_comment and delete_comment change one of the user's own comments (commentId from spark_jira read); delete removes the issue (withSubtasks to remove its subtasks too). Create, comment, move and assign with the ticket tools. The card shows before and after. ${ACTION_NOTE}`,
  input: {
    action: jiraEditOpSchema,
    key: ticketKeySchema,
    summary: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(ATLASSIAN_BODY_MAX).optional(),
    labels: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    priority: z.string().trim().min(1).max(100).optional(),
    commentId: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    body: z.string().trim().min(1).max(ATLASSIAN_BODY_MAX).optional(),
    withSubtasks: z.boolean().default(false),
  },
  run: (args, context) => edit(context, args),
});
