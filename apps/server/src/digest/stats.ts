import { DIGEST_HEADLINE_MAX_LENGTH, type DigestStats } from '@spark-outpost/contracts';
import type { ActivityChat } from './input.ts';
import { ellipsize } from './text.ts';

export const EMPTY_DIGEST_STATS: DigestStats = {
  finished: 0,
  waiting: 0,
  failedOrStalled: 0,
  costUsd: null,
};

export function computeDigestStats(chats: readonly ActivityChat[]): DigestStats {
  const finished = chats.filter((chat) => chat.state === 'finished').length;
  const waiting = chats.filter((chat) => chat.state === 'waiting').length;
  const failedOrStalled = chats.filter(
    (chat) => chat.state === 'failed' || chat.state === 'stalled',
  ).length;
  const costs = chats.map((chat) => chat.costUsd).filter((cost): cost is number => cost !== null);
  const costUsd = costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : null;
  return { finished, waiting, failedOrStalled, costUsd };
}

function formatUsd(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function fallbackHeadline(stats: DigestStats): string {
  const parts = [
    stats.finished > 0 ? plural(stats.finished, 'chat finished', 'chats finished') : null,
    stats.waiting > 0 ? plural(stats.waiting, 'chat needs you', 'chats need you') : null,
    stats.failedOrStalled > 0
      ? plural(stats.failedOrStalled, 'chat failed or stalled', 'chats failed or stalled')
      : null,
  ].filter((part): part is string => part !== null);
  const activity = parts.length > 0 ? parts.join(', ') : 'Nothing new';
  const spend =
    stats.costUsd !== null && stats.costUsd > 0 ? `, ${formatUsd(stats.costUsd)} spent` : '';
  return ellipsize(`${activity}${spend}.`, DIGEST_HEADLINE_MAX_LENGTH);
}
