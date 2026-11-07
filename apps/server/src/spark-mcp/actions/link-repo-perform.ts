import type { LinkRepoAction } from '@spark-outpost/contracts';
import {
  appendConversationProject,
  type AppendedProject,
} from '../../persistence/conversation-projects.ts';
import { withTransaction, type Queryable } from '../../persistence/db.ts';
import {
  SESSION_CLOSE_REASONS,
  closeConversationSessions,
} from '../../persistence/provider-sessions.ts';
import { createProject } from '../../projects/projects.ts';
import { linkTarget } from '../../projects/repo-lookup.ts';
import { sparkReposRules } from '../../projects/repos-folders.ts';
import type { SparkToolContext } from '../tool.ts';
import type { Performed } from './performed.ts';

function resultLine(outcome: AppendedProject, repo: string): string {
  if (outcome === 'already_linked') return `${repo} is already linked to this chat.`;
  if (outcome === 'full') {
    return `This chat already has the most repositories it can link. Unlink one first, then link ${repo}.`;
  }
  return `Linked ${repo}. This chat can use it from your next message.`;
}

export async function linkProjectToChat(
  client: Queryable,
  workspaceId: string,
  conversationId: string,
  projectId: string,
): Promise<AppendedProject> {
  const appended = await appendConversationProject(client, workspaceId, conversationId, projectId);
  if (appended === 'linked') {
    await closeConversationSessions(
      client,
      workspaceId,
      conversationId,
      SESSION_CLOSE_REASONS.repos,
    );
  }
  return appended;
}

export async function performLinkRepo(
  context: SparkToolContext,
  action: LinkRepoAction,
): Promise<Performed> {
  const { workspaceId, conversationId } = context.scope;
  if (!conversationId) throw new Error('Repositories are linked only to a chat.');
  const outcome = await withTransaction(context.deps.db, async (client) => {
    const target = await linkTarget(client, workspaceId, action.path, sparkReposRules());
    if (target.path !== action.path || target.origin !== action.origin) {
      throw new Error(
        `${action.displayPath} changed after the card was shown, so nothing was linked. Ask again to link it.`,
      );
    }
    const projectId =
      target.projectId ?? (await createProject(client, workspaceId, target.path)).project.id;
    const appended = await linkProjectToChat(client, workspaceId, conversationId, projectId);
    if (appended === 'full') throw new Error(resultLine(appended, action.repo));
    return appended;
  });
  return { message: resultLine(outcome, action.repo), url: null };
}
