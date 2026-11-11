import {
  CALENDAR_UPCOMING_COUNT,
  freshUpdate,
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

export function dayTitle(lead: LeadState): string {
  return lead === 'meeting' ? 'After the meeting' : 'Your day';
}

export function dayEvents(
  events: readonly CalendarEvent[],
  hideKey: string | null,
): CalendarEvent[] {
  return events.filter((event) => event.key !== hideKey);
}

export interface DayChoice {
  title: string;
  tomorrow: boolean;
  events: CalendarEvent[];
  empty: string;
}

export function dayChoice(
  lead: LeadState,
  hideKey: string | null,
  today: readonly CalendarEvent[],
  tomorrow: readonly CalendarEvent[],
): DayChoice {
  if (lead === 'before-you-go' && tomorrow.length > 0) {
    return {
      title: 'Tomorrow',
      tomorrow: true,
      events: tomorrow.slice(0, CALENDAR_UPCOMING_COUNT),
      empty: '',
    };
  }
  return {
    title: dayTitle(lead),
    tomorrow: false,
    events: dayEvents(today, hideKey),
    empty: 'No more meetings today.',
  };
}
