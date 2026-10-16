import type { CalendarEvent, ConversationSummary } from '@spark-outpost/contracts';
import { spanOf } from '@spark-outpost/contracts';
import { rowState } from '../conversations/row-state.ts';
import { WarnIcon } from '../ui/icons.tsx';
import { clock } from './calendar-format.ts';

export interface Overlap {
  event: CalendarEvent;
  chat: ConversationSummary;
}

interface TodayChatsProps {
  chats: readonly ConversationSummary[];
  overlaps: readonly Overlap[];
  onOpenChat: (id: string) => void;
}

const SHOWN = new Set(['running', 'permission', 'asking']);

export function OverlapLine({ overlap }: { overlap: Overlap }) {
  return (
    <p className="td-warn">
      <WarnIcon />
      <span>
        <b>
          {overlap.event.title} at {clock(spanOf(overlap.event).start)}
        </b>{' '}
        overlaps “{overlap.chat.title}”, still running.
      </span>
    </p>
  );
}

export function TodayChats({ chats, overlaps, onOpenChat }: TodayChatsProps) {
  const rows = chats
    .filter((chat) => !chat.archivedAt)
    .map((chat) => ({ chat, state: rowState(chat, false) }))
    .filter(({ state }) => SHOWN.has(state.tone));
  return (
    <section className="hpanel td-chats" aria-labelledby="td-chats-h">
      <h2 id="td-chats-h">Your chats today</h2>
      {rows.length === 0 ? (
        <p className="td-hint">No chat is running or waiting for you.</p>
      ) : (
        <ul>
          {rows.map(({ chat, state }) => (
            <li key={chat.id}>
              <button type="button" className="td-chat" onClick={() => onOpenChat(chat.id)}>
                <i className="td-dot" data-tone={state.tone} aria-hidden="true" />
                <span>
                  <b>{chat.title}</b>
                  <small>{state.label}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {overlaps.map((overlap) => (
        <OverlapLine key={overlap.event.key} overlap={overlap} />
      ))}
    </section>
  );
}
