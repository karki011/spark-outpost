import type { PrRefreshProblem } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { pollChatPullsNow, pullById, requestRefresh } from '../persistence/tracked-pulls.ts';
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

const ANSWER_WAIT_MS = 20_000;
const ANSWER_STEP_MS = 150;

interface PullRefreshTarget {
  workspaceId: string;
  conversationId: string;
  watchId: string;
}

type PullRefreshOutcome = { found: false } | { found: true; problem: PrRefreshProblem | null };

interface PullRefresher {
  refresh(target: PullRefreshTarget): Promise<PullRefreshOutcome>;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function answered(db: Db, target: PullRefreshTarget, waitMs: number) {
  const asked = await requestRefresh(db, target.workspaceId, target.conversationId, target.watchId);
  if (!asked) return { found: false } as const;
  await db.query('SELECT pg_notify($1, $2)', [POLL_CHANNEL, '']);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await pause(ANSWER_STEP_MS);
    const pull = await pullById(db, target.watchId);
    if (!pull) return { found: false } as const;
    if (!pull.refreshRequested) return { found: true, problem: pull.pollProblem } as const;
  }
  return { found: true, problem: 'no_answer' } as const;
}

export function pullRefresher(db: Db, waitMs = ANSWER_WAIT_MS): PullRefresher {
  const waiting = new Map<string, Promise<PullRefreshOutcome>>();
  return {
    refresh(target) {
      const key = `${target.workspaceId} ${target.conversationId} ${target.watchId}`;
      const running = waiting.get(key);
      if (running) return running;
      const started = answered(db, target, waitMs).finally(() => waiting.delete(key));
      waiting.set(key, started);
      return started;
    },
  };
}
