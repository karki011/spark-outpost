import type { ConversationSummary } from '@spark-outpost/contracts';
import type { ScoutMood } from '../brand/BlobScout.tsx';
import { needsYou, runningNow, type NeedItem, type RunItem } from '../home/home-model.ts';

const FINISHED_LIMIT = 3;

export interface CompanionFeed {
  needs: NeedItem[];
  running: RunItem[];
  finished: NeedItem[];
  errors: NeedItem[];
}

type CompanionMood = 'idle' | 'working' | 'alert' | 'happy' | 'sad';

interface MoodContext {
  celebrating: boolean;
  seenErrors: ReadonlySet<string>;
}

export function companionFeed(chats: readonly ConversationSummary[]): CompanionFeed {
  const items = needsYou(chats);
  return {
    needs: items.filter((item) => item.tone === 'asking'),
    running: runningNow(chats),
    finished: items
      .filter((item) => item.tone === 'done')
      .toSorted((a, b) => b.chat.updatedAt.localeCompare(a.chat.updatedAt))
      .slice(0, FINISHED_LIMIT),
    errors: items.filter((item) => item.tone === 'error'),
  };
}

export function errorKey(chat: ConversationSummary): string {
  return chat.latestRun?.id ?? chat.id;
}

export function unseenErrors(feed: CompanionFeed, seen: ReadonlySet<string>): NeedItem[] {
  return feed.errors.filter((item) => !seen.has(errorKey(item.chat)));
}

export function companionMood(feed: CompanionFeed, context: MoodContext): CompanionMood {
  if (feed.needs.length > 0) return 'alert';
  if (unseenErrors(feed, context.seenErrors).length > 0) return 'sad';
  if (feed.running.length > 0) return 'working';
  if (context.celebrating || feed.finished.length > 0) return 'happy';
  return 'idle';
}

export function scoutMood(mood: CompanionMood): ScoutMood {
  return mood === 'idle' ? null : mood;
}

export function statusText(feed: CompanionFeed): string {
  const needs = feed.needs.length;
  const parts = [
    needs > 0 ? `${needs} ${needs === 1 ? 'needs' : 'need'} you` : null,
    feed.running.length > 0 ? `${feed.running.length} running` : null,
    feed.errors.length > 0 ? `${feed.errors.length} failed` : null,
    feed.finished.length > 0 ? `${feed.finished.length} finished` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'all quiet' : parts.join(', ');
}

const RUNNING_DOTS = 5;

export function runningDots(count: number): number | string {
  return count > RUNNING_DOTS ? `${RUNNING_DOTS}+` : count;
}

export function statusLabel(feed: CompanionFeed): string {
  return `Status: ${statusText(feed)}`;
}

export type RunStatuses = ReadonlyMap<string, string>;

export function runStatuses(chats: readonly ConversationSummary[]): Map<string, string> {
  return new Map(
    chats.flatMap((chat) => (chat.latestRun ? [[chat.latestRun.id, chat.latestRun.status]] : [])),
  );
}

export function finishedRunIds(
  previous: RunStatuses,
  chats: readonly ConversationSummary[],
): string[] {
  return chats.flatMap((chat) => {
    const run = chat.latestRun;
    if (!run || run.status !== 'succeeded') return [];
    const before = previous.get(run.id);
    return before === 'running' || before === 'queued' ? [run.id] : [];
  });
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export function nearestCorner(x: number, y: number, width: number, height: number): Corner {
  const vertical = y < height / 2 ? 'top' : 'bottom';
  const horizontal = x < width / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}`;
}
