import {
  AWAY_MS,
  alerting,
  freshUpdate,
  type AttentionItem,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { rowState } from '../conversations/row-state.ts';

export type SinceKind = 'failed' | 'waiting' | 'clean' | 'finished';

export interface SinceRow {
  key: string;
  chat: ConversationSummary;
  kind: SinceKind;
  line: string;
  unread: boolean;
  at: string;
}

export const SINCE_MAX = 5;

const RANK: Record<SinceKind, number> = { failed: 0, waiting: 1, clean: 2, finished: 3 };

function kindOf(item: AttentionItem): SinceKind | null {
  if (item.kind === 'run-failed') return 'failed';
  if (item.kind === 'run-done') return 'finished';
  if (item.kind === 'pr-clean') return 'clean';
  if (item.kind === 'approval' || item.kind === 'terminal') return 'waiting';
  return null;
}

function isAwayUpdate(item: AttentionItem): boolean {
  const kind = kindOf(item);
  return (kind === 'failed' || kind === 'finished' || kind === 'clean') && freshUpdate(item);
}

function timeOf(iso: string | null): number | null {
  const time = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

export function awayKeys(
  items: readonly AttentionItem[],
  seenAt: string | null,
  now: number,
): Set<string> {
  const seen = timeOf(seenAt);
  if (seen !== null && now - seen < AWAY_MS) return new Set();
  const after = (item: AttentionItem) => seen === null || (timeOf(item.at) ?? 0) > seen;
  return new Set(items.filter((item) => isAwayUpdate(item) && after(item)).map((item) => item.key));
}

const FALLBACK_LINE: Record<SinceKind, string> = {
  failed: 'The turn stopped with an error',
  waiting: 'Waiting for your answer',
  clean: 'PR is clean · ready to merge',
  finished: 'Finished · open to review',
};

function lineFor(kind: SinceKind, chat: ConversationSummary): string {
  const state = rowState(chat, false);
  const matches =
    (kind === 'failed' && state.tone === 'error') ||
    (kind === 'finished' && state.tone === 'done') ||
    (kind === 'waiting' && (state.tone === 'asking' || state.tone === 'permission'));
  return matches && state.sub ? state.sub : FALLBACK_LINE[kind];
}

function shown(item: AttentionItem, away: ReadonlySet<string>): boolean {
  const kind = kindOf(item);
  if (kind === 'waiting') return item.blocking && !item.setAsideAt && !item.dismissedAt;
  return away.has(item.key) && isAwayUpdate(item);
}

export function sinceRows(
  items: readonly AttentionItem[],
  away: ReadonlySet<string>,
  chats: readonly ConversationSummary[],
): SinceRow[] {
  const byId = new Map(chats.filter((chat) => !chat.archivedAt).map((chat) => [chat.id, chat]));
  return items
    .flatMap((item): SinceRow[] => {
      const kind = kindOf(item);
      const chat = byId.get(item.conversationId);
      if (!kind || !chat || !shown(item, away)) return [];
      return [
        {
          key: item.key,
          chat,
          kind,
          line: lineFor(kind, chat),
          unread: kind === 'waiting' ? alerting(item) : true,
          at: item.at,
        },
      ];
    })
    .toSorted((a, b) => RANK[a.kind] - RANK[b.kind] || b.at.localeCompare(a.at));
}

export function capRows<T>(rows: readonly T[], max = SINCE_MAX): { shown: T[]; more: T[] } {
  return { shown: rows.slice(0, max), more: rows.slice(max) };
}
