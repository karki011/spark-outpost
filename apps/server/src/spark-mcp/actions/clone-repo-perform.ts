import type { CloneJob, CloneRepoAction } from '@spark-outpost/contracts';
import { withTransaction } from '../../persistence/db.ts';
import type { SparkToolContext } from '../tool.ts';
import { linkProjectToChat } from './link-repo-perform.ts';
import type { Performed } from './performed.ts';

function failureLine(job: CloneJob | null, repo: string): string {
  if (!job || job.status === 'cancelled')
    return `The clone of ${repo} stopped, so nothing was added.`;
  const failure = job.failure;
  const reason = failure ? `${failure.summary} ${failure.detail}`.trim() : 'it failed.';
  return `Spark could not clone ${repo}, so nothing was added. ${reason}`;
}

export async function performCloneRepo(
  context: SparkToolContext,
  action: CloneRepoAction,
): Promise<Performed> {
  const { workspaceId, conversationId } = context.scope;
  if (!conversationId) throw new Error('Repositories are cloned and linked only from a chat.');
  const clones = context.deps.clones?.(workspaceId);
  if (!clones) throw new Error('Spark cannot clone repositories here.');
  const { job } = await clones.start({
    url: action.url,
    parentPath: action.parentPath,
    name: action.name,
  });
  const settled = await clones.settled(job.id);
  const project = settled?.status === 'done' ? settled.project : null;
  if (!project) throw new Error(failureLine(settled, action.repo));
  const linked = await withTransaction(context.deps.db, (client) =>
    linkProjectToChat(client, workspaceId, conversationId, project.id),
  );
  const where = `Cloned ${action.repo} into ${action.displayPath}`;
  if (linked === 'full') {
    return {
      message: `${where} and added it as a project. This chat already links the most repositories it can, so it isn't linked here.`,
      url: null,
    };
  }
  return {
    message: `${where} and linked it. This chat can use it from your next message.`,
    url: null,
  };
}
