import type { PublishPlan } from '../orchestration/agent-publish.ts';
import { watchPullRequest } from '../persistence/pr-watches.ts';
import { saveTaskShip } from '../persistence/task-ships.ts';
import { addTaskLink } from '../persistence/tasks.ts';
import type { GitHubDeps } from '../ship/github/access.ts';
import type { Published } from '../ship/published.ts';
import { repoSlug } from '../ship/remote.ts';
import { syncRecordedPull } from '../tickets/ship-sync.ts';

export interface PublishedChat {
  workspaceId: string;
  conversationId: string;
  taskId: string | null;
}

export async function recordPullRequest(
  deps: GitHubDeps,
  chat: PublishedChat,
  plan: PublishPlan,
  published: Published,
): Promise<void> {
  const { pull, repo } = published;
  const { taskId } = chat;
  if (!pull || !repo || !taskId) return;
  const title = `${repoSlug(repo)}#${pull.number}`;
  await addTaskLink(deps.db, taskId, { kind: 'pr', url: pull.url, title, source: 'ship' });
  await watchPullRequest(deps.db, {
    workspaceId: chat.workspaceId,
    conversationId: chat.conversationId,
    taskId,
    host: repo.host,
    owner: repo.owner,
    repo: repo.name,
    number: pull.number,
    url: pull.url,
    branch: plan.branch,
  });
  await saveTaskShip(deps.db, taskId, {
    rootPath: plan.root,
    branch: plan.branch,
    baseBranch: plan.base,
    remote: published.remote,
    lastCommit: published.head,
    pushedAt: new Date(),
    prUrl: pull.url,
    prNumber: pull.number,
  });
  void syncRecordedPull(deps, {
    host: repo.host,
    owner: repo.owner,
    repo: repo.name,
    number: pull.number,
  });
}
