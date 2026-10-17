import type { ConversationSummary } from '@spark-outpost/contracts';
import type { CalendarLine } from '../calendar/island-calendar.ts';
import type { Card } from './island-model.ts';
import { waitingTitle } from './island-rest-line.ts';
import { momentLine } from './use-island-moments.ts';

export const NEEDS_YOU_ROWS = 4;

export type NeedsYouRow =
  | { kind: 'waiting' | 'done' | 'failed'; key: string; text: string; chatId: string }
  | { kind: 'calendar'; key: string; text: string; line: CalendarLine };

export interface NeedsYou {
  rows: NeedsYouRow[];
  more: number;
}

const CALENDAR_KINDS: ReadonlySet<CalendarLine['kind']> = new Set(['nudge', 'capture', 'catch-up']);

function finished(chat: ConversationSummary): 'done' | 'failed' | null {
  if (chat.archivedAt || chat.needsInput || !chat.unread) return null;
  const status = chat.latestRun?.status;
  if (status === 'failed') return 'failed';
  if (status === 'succeeded') return 'done';
  return null;
}

function finishedRows(chats: readonly ConversationSummary[]): NeedsYouRow[] {
  const rows = chats.flatMap((chat): NeedsYouRow[] => {
    const kind = finished(chat);
    if (!kind) return [];
    return [
      {
        kind,
        key: `${kind}:${chat.id}`,
        text: momentLine(kind, chat.title, null),
        chatId: chat.id,
      },
    ];
  });
  return [
    ...rows.filter((row) => row.kind === 'failed'),
    ...rows.filter((row) => row.kind === 'done'),
  ];
}

export function needsYou(
  cards: readonly Card[],
  chats: readonly ConversationSummary[],
  line: CalendarLine | null,
): NeedsYou {
  const waiting = cards
    .filter((card) => !card.loading)
    .map((card): NeedsYouRow => ({
      kind: 'waiting',
      key: `waiting:${card.approval?.id ?? card.chat.id}`,
      text: waitingTitle(card),
      chatId: card.chat.id,
    }));
  const calendar: NeedsYouRow[] =
    line && CALENDAR_KINDS.has(line.kind)
      ? [{ kind: 'calendar', key: `calendar:${line.key}`, text: line.text, line }]
      : [];
  const all = [...waiting, ...calendar, ...finishedRows(chats)];
  return { rows: all.slice(0, NEEDS_YOU_ROWS), more: Math.max(0, all.length - NEEDS_YOU_ROWS) };
}
