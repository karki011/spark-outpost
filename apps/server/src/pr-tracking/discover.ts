import { z } from 'zod';
import type { PrChecks } from '@spark-outpost/contracts';
import { trackedPullsOf, type TrackedPull } from '../persistence/tracked-pulls.ts';
import { connectionFor, type GitHubDeps } from '../ship/github/access.ts';
import { repoPath } from '../ship/github/connection.ts';
import { chatRepos, type ChatBranch, type ChatRepo } from './chat-repos.ts';
import { trackChatPull } from './track.ts';

const MAX_PER_BRANCH = 10;

const listedPullSchema = z.object({
  html_url: z.string().url(),
  number: z.number().int().positive(),
  title: z.string().optional(),
  draft: z.boolean().optional(),
  head: z.object({ ref: z.string() }),
  base: z.object({ ref: z.string() }).optional(),
});

export interface ChatPullRequest {
  url: string;
  number: number;
  owner: string;
  repo: string;
  state: 'draft' | 'open' | 'merged' | 'closed';
  branch: string;
  base: string | null;
  title: string | null;
  checks: PrChecks;
  outside: boolean;
  openedVia: TrackedPull['openedVia'];
}

function toChatPullRequest(pull: TrackedPull): ChatPullRequest {
  return {
    url: pull.url,
    number: pull.number,
    owner: pull.owner,
    repo: pull.repo,
    state: pull.prState === 'open' && pull.draft ? 'draft' : pull.prState,
    branch: pull.branch,
    base: pull.base,
    title: pull.title,
    checks: pull.checks,
    outside: pull.outside,
    openedVia: pull.openedVia,
  };
}

async function discoverOnBranch(
  deps: GitHubDeps,
  conversationId: string,
  chatRepo: ChatRepo,
  branch: ChatBranch,
): Promise<void> {
  const connection = await connectionFor(deps, chatRepo.repo);
  if (!connection) return;
  const query = new URLSearchParams({
    head: `${chatRepo.repo.owner}:${branch.name}`,
    state: branch.owned ? 'all' : 'open',
    per_page: String(MAX_PER_BRANCH),
  });
  const found = await connection.get(
    `${repoPath(chatRepo.repo)}/pulls?${query.toString()}`,
    z.array(listedPullSchema),
    `looking for pull requests from ${branch.name}`,
  );
  for (const pull of found.filter((entry) => entry.head.ref === branch.name)) {
    await trackChatPull(deps.db, {
      conversationId,
      url: pull.html_url,
      via: 'discovery',
      by: null,
      runId: null,
      taskId: null,
      head: pull.head.ref,
      base: pull.base?.ref ?? null,
      title: pull.title ?? null,
      draft: pull.draft ?? false,
    });
  }
}

export async function discoverChatPullRequests(
  deps: GitHubDeps,
  conversationId: string,
): Promise<ChatPullRequest[]> {
  for (const chatRepo of await chatRepos(deps.db, conversationId)) {
    for (const branch of chatRepo.branches) {
      await discoverOnBranch(deps, conversationId, chatRepo, branch).catch((error: unknown) => {
        console.error('Could not look for pull requests on a chat branch', error);
      });
    }
  }
  const tracked = await trackedPullsOf(deps.db, deps.workspaceId, conversationId);
  return tracked.map(toChatPullRequest);
}
