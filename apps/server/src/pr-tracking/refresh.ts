import { pollChatPullsNow } from '../persistence/tracked-pulls.ts';
import type { GitHubDeps } from '../ship/github/access.ts';
import { discoverChatPullRequests } from './discover.ts';

const DISCOVER_EVERY_MS = 60_000;
const STALE_AFTER_MS = 30_000;
const MAX_REMEMBERED = 500;
export const POLL_CHANNEL = 'pr_poll';

export interface ChatPullRefresher {
  refresh(conversationId: string): Promise<void>;
}

export function chatPullRefresher(
  deps: GitHubDeps,
  now: () => number = Date.now,
): ChatPullRefresher {
  const discoveredAt = new Map<string, number>();

  const dueForDiscovery = (conversationId: string) => {
    const last = discoveredAt.get(conversationId);
    if (last !== undefined && now() - last < DISCOVER_EVERY_MS) return false;
    if (discoveredAt.size >= MAX_REMEMBERED) discoveredAt.clear();
    discoveredAt.set(conversationId, now());
    return true;
  };

  return {
    async refresh(conversationId) {
      if (dueForDiscovery(conversationId)) await discoverChatPullRequests(deps, conversationId);
      const woken = await pollChatPullsNow(
        deps.db,
        deps.workspaceId,
        conversationId,
        new Date(now() - STALE_AFTER_MS),
      );
      if (woken > 0) await deps.db.query('SELECT pg_notify($1, $2)', [POLL_CHANNEL, '']);
    },
  };
}
