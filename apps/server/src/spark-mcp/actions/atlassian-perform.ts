import {
  atlassianProductNames,
  type AtlassianReadAction,
  type ConfluenceEditAction,
  type JiraEditAction,
} from '@spark-outpost/contracts';
import { ConfluenceConflictError } from '../../atlassian/confluence.ts';
import { markdownToStorage } from '../../atlassian/confluence-format.ts';
import { openAtlassian } from '../../atlassian/session.ts';
import { ticketDepsFor } from '../deps.ts';
import type { SparkToolContext } from '../tool.ts';
import { versionMoved } from '../tools/atlassian/confluence-edit-tool.ts';
import type { Performed } from './performed.ts';

class AtlassianChangedError extends Error {}

export const JIRA_CHANGED =
  'The issue changed in Jira after the card was shown, so Spark changed nothing. Ask the agent to read it again.';

const session = (context: SparkToolContext, product: 'jira' | 'confluence') =>
  openAtlassian(ticketDepsFor(context.deps, context.scope), product);

export function performAtlassianRead(action: AtlassianReadAction): Promise<Performed> {
  return Promise.resolve({
    message: `The agent can read ${atlassianProductNames[action.product]} in this chat.`,
    url: null,
  });
}

async function jiraComment(context: SparkToolContext, action: JiraEditAction) {
  const { jira } = await session(context, 'jira');
  const { ticket, comment } = action;
  const current = await jira.comment(ticket.key, comment!.id);
  if (current.updatedAt !== comment!.updatedAt) throw new AtlassianChangedError(JIRA_CHANGED);
  if (action.op === 'delete_comment') {
    await jira.deleteComment(ticket.key, comment!.id);
    return { message: `Deleted your comment on ${ticket.key}.`, url: ticket.url };
  }
  await jira.editComment(ticket.key, comment!.id, comment!.after ?? '');
  return { message: `Edited your comment on ${ticket.key}.`, url: ticket.url };
}

export async function performJiraEdit(
  context: SparkToolContext,
  action: JiraEditAction,
): Promise<Performed> {
  if (action.op === 'edit_comment' || action.op === 'delete_comment') {
    return jiraComment(context, action);
  }
  const { jira } = await session(context, 'jira');
  const { ticket } = action;
  const now = await jira.facts(ticket.key);
  if (now.updated !== action.updated) throw new AtlassianChangedError(JIRA_CHANGED);
  if (action.op === 'delete') {
    if (now.subtasks.toSorted().join(',') !== action.subtasks.toSorted().join(',')) {
      throw new AtlassianChangedError(JIRA_CHANGED);
    }
    await jira.deleteIssue(ticket.key, action.subtasks.length > 0);
    return { message: `Deleted ${ticket.key}.`, url: null, output: { key: ticket.key } };
  }
  await jira.update(ticket.key, action.changes);
  return {
    message: `Changed ${Object.keys(action.changes).join(', ')} on ${ticket.key}.`,
    url: ticket.url,
    output: { key: ticket.key },
  };
}

export async function performConfluenceEdit(
  context: SparkToolContext,
  action: ConfluenceEditAction,
): Promise<Performed> {
  const { confluence } = await session(context, 'confluence');
  const { page } = action;
  if (action.op === 'create') {
    const created = await confluence.create({
      spaceId: page.spaceId!,
      parentId: page.parentId,
      title: page.title,
      storage: markdownToStorage(action.body ?? ''),
    });
    return {
      message: `Created the page ${created.title}.`,
      url: created.url,
      output: { pageId: created.id, version: created.version },
    };
  }
  const current = await confluence.page(page.id!);
  if (current.version !== page.version) {
    throw new AtlassianChangedError(versionMoved(current.id, page.version ?? 0, current.version));
  }
  if (action.op === 'comment') {
    const id = await confluence.comment(current.id, markdownToStorage(action.body ?? ''));
    return {
      message: `Commented on ${current.title}.`,
      url: current.url,
      output: { commentId: id },
    };
  }
  if (action.op === 'delete') {
    await confluence.remove(current.id);
    return { message: `Moved ${current.title} to the Confluence trash.`, url: null };
  }
  try {
    const saved = await confluence.update({
      id: current.id,
      title: action.after?.title ?? current.title,
      storage: action.body === null ? current.storage : markdownToStorage(action.body),
      version: current.version,
    });
    return {
      message: `Saved ${saved.title} as version ${saved.version}.`,
      url: saved.url,
      output: { pageId: saved.id, version: saved.version },
    };
  } catch (error) {
    if (error instanceof ConfluenceConflictError) throw new AtlassianChangedError(error.message);
    throw error;
  }
}
