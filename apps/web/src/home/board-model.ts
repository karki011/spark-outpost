import {
  freshUpdate,
  spanOf,
  type CalendarEvent,
  type AttentionItem,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import type { LeadState } from './lead-state.ts';
import type { NeedItem } from './home-model.ts';

export type NeedsColumn = 'needs' | 'pickup';

export function leftoverNeeds(need: readonly NeedItem[], inLead: ReadonlySet<string>): NeedItem[] {
  return need.filter((item) => item.tone !== 'done' && !inLead.has(item.chat.id));
}

export function needsColumn(leftover: readonly NeedItem[]): NeedsColumn {
  return leftover.length > 0 ? 'needs' : 'pickup';
}

export interface ReviewItem {
  chat: ConversationSummary;
  clean: boolean;
  line: string;
  attentionKey: string | null;
}

export function reviewItems(
  need: readonly NeedItem[],
  attention: readonly AttentionItem[],
  chats: readonly ConversationSummary[],
  inLead: ReadonlySet<string>,
): ReviewItem[] {
  const byId = new Map(chats.filter((chat) => !chat.archivedAt).map((chat) => [chat.id, chat]));
  const clean = attention
    .filter(
      (item) => item.kind === 'pr-clean' && freshUpdate(item) && byId.has(item.conversationId),
    )
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .map((item): ReviewItem => ({
      chat: byId.get(item.conversationId)!,
      clean: true,
      line: 'PR is clean · ready to merge',
      attentionKey: item.key,
    }));
  const seen = new Set(clean.map((entry) => entry.chat.id));
  const finished = need
    .filter((item) => item.tone === 'done' && !seen.has(item.chat.id))
    .map((item): ReviewItem => ({
      chat: item.chat,
      clean: false,
      line: item.sub || 'Finished · open to review',
      attentionKey: null,
    }));
  return [...clean, ...finished].filter((entry) => !inLead.has(entry.chat.id));
}

export function dayTitle(lead: LeadState, hasTomorrow: boolean): string {
  if (lead === 'meeting') return 'After the meeting';
  if (lead === 'before-you-go' && hasTomorrow) return 'Tomorrow';
  return 'Your day';
}

export function splitDays(
  events: readonly CalendarEvent[],
  now: number,
  hideKey: string | null,
): { today: CalendarEvent[]; tomorrow: CalendarEvent[] } {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const after = new Date(midnight);
  after.setDate(after.getDate() + 1);
  const shown = events.filter((event) => event.key !== hideKey);
  return {
    today: shown.filter((event) => spanOf(event).start < midnight.getTime()),
    tomorrow: shown.filter((event) => {
      const { start } = spanOf(event);
      return start >= midnight.getTime() && start < after.getTime();
    }),
  };
}
