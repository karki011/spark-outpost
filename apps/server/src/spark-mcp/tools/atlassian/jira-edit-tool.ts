import { z } from 'zod';
import {
  ATLASSIAN_BODY_MAX,
  ATLASSIAN_CARD_TEXT_MAX,
  atlassianConfirm,
  jiraEditOpSchema,
  ticketKeySchemaFor,
  type JiraChanges,
  type JiraEditAction,
  type JiraEditOp,
  type JiraIssueFacts,
} from '@spark-outpost/contracts';
import type { JiraFacts } from '../../../atlassian/jira-edits.ts';
import { resolveTeam } from '../../../atlassian/jira-hierarchy.ts';
import { projectOfKey } from '../../../tickets/ticket-relations.ts';
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
  parent?: string | undefined;
  issueType?: string | undefined;
  team?: string | undefined;
  commentId?: string | undefined;
  body?: string | undefined;
  withSubtasks: boolean;
}

const card = (text: string) => text.slice(0, ATLASSIAN_CARD_TEXT_MAX);

type ShownFacts = Pick<JiraFacts, 'summary' | 'description' | 'labels' | 'priority' | 'type'> & {
  parent: string | null;
  team: string | null;
};

const teamLabel = (team: { id: string; name: string | null } | null) =>
  team ? (team.name ?? team.id) : null;

function issueFacts(facts: ShownFacts): JiraIssueFacts {
  return {
    summary: facts.summary,
    description: card(facts.description),
    labels: facts.labels,
    priority: facts.priority,
    parent: facts.parent,
    type: facts.type,
    team: facts.team,
  };
}

const shown = (facts: JiraFacts): ShownFacts => ({
  ...facts,
  parent: facts.parent?.key ?? null,
  team: teamLabel(facts.team),
});

async function changesOf(session: AtlassianSession, args: EditArgs): Promise<JiraChanges> {
  const changes: JiraChanges = {};
  if (args.summary !== undefined) changes.summary = args.summary;
  if (args.description !== undefined) changes.description = args.description;
  if (args.labels !== undefined) {
    changes.labels = args.labels.map((label) => label.replace(/\s+/g, '-'));
  }
  if (args.priority !== undefined) changes.priority = args.priority;
  if (args.parent !== undefined) changes.parent = args.parent.toUpperCase();
  if (args.issueType !== undefined) changes.issueType = args.issueType;
  if (args.team !== undefined) {
    const project = projectOfKey(args.key, null) ?? args.key;
    changes.team = await resolveTeam(session.jira.client, project, args.team);
  }
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
    const changes = await changesOf(session, args);
    if (Object.keys(changes).length === 0) {
      throw new SparkToolError(
        'Pass at least one of summary, description, labels, priority, parent, issueType or team.',
      );
    }
    const before = shown(facts);
    return {
      ...action,
      changes,
      before: issueFacts(before),
      after: issueFacts({
        summary: changes.summary ?? before.summary,
        description: changes.description ?? before.description,
        labels: changes.labels ?? before.labels,
        priority: changes.priority ?? before.priority,
        parent: changes.parent ?? before.parent,
        type: changes.issueType ?? before.type,
        team: changes.team ? teamLabel(changes.team) : before.team,
      }),
    };
  }
  if (args.action === 'delete') {
    if (facts.subtasks.length > 0 && !args.withSubtasks) {
      throw new SparkToolError(
        `${facts.key} has subtasks (${facts.subtasks.join(', ')}). Nothing was deleted. Pass withSubtasks true to delete them with it.`,
      );
    }
    return { ...action, before: issueFacts(shown(facts)), subtasks: facts.subtasks };
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
  description: `Changes a Jira issue: update sets summary, description (Markdown), labels (replaces them), priority, parent (epic or story key), issueType or team (name or id); edit_comment and delete_comment change one of the user's own comments (commentId from spark_jira read); delete removes the issue (withSubtasks for its subtasks). Create, comment, move and assign with the ticket tools. ${ACTION_NOTE}`,
  input: {
    action: jiraEditOpSchema,
    key: ticketKeySchemaFor('jira'),
    summary: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(ATLASSIAN_BODY_MAX).optional(),
    labels: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    priority: z.string().trim().min(1).max(100).optional(),
    parent: ticketKeySchemaFor('jira').optional(),
    issueType: z.string().trim().min(1).max(100).optional(),
    team: z.string().trim().min(1).max(100).optional(),
    commentId: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    body: z.string().trim().min(1).max(ATLASSIAN_BODY_MAX).optional(),
    withSubtasks: z.boolean().default(false),
  },
  run: (args, context) => edit(context, args),
});
