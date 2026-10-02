import type { ConversationSummary } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { sessionState, type SessionState } from './island-model.ts';
import { sessionExpression } from './island-mood.ts';
import { SessionBlob } from './SessionBlob.tsx';

export const STATUS_WORDS: Record<SessionState, string> = {
  working: 'running',
  waiting: 'needs you',
  done: 'done',
  failed: 'failed',
  idle: 'quiet',
};

const ATTENTION_FIRST: Record<SessionState, number> = {
  waiting: 0,
  failed: 1,
  working: 2,
  done: 3,
  idle: 4,
};

export function hoverOrder(sessions: readonly ConversationSummary[]): ConversationSummary[] {
  return sessions.toSorted(
    (a, b) =>
      ATTENTION_FIRST[sessionState(a)] - ATTENTION_FIRST[sessionState(b)] ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}

interface HoverListProps {
  sessions: readonly ConversationSummary[];
  more: number;
  now: number;
  sleepy: boolean;
  onOpen: (id: string) => void;
  onAll: () => void;
}

export function HoverList({ sessions, more, now, sleepy, onOpen, onAll }: HoverListProps) {
  return (
    <div className="isl-body isl-hover">
      <ul className="isl-hlist" aria-label="Active chats">
        {hoverOrder(sessions).map((chat) => {
          const state = sessionState(chat);
          return (
            <li key={chat.id}>
              <button
                type="button"
                className="isl-hrow"
                data-state={state}
                onClick={() => onOpen(chat.id)}
              >
                <SessionBlob
                  chat={chat}
                  state={state}
                  size={22}
                  expression={sessionExpression(state, sleepy)}
                />
                <span className="isl-htitle">{chat.title}</span>
                <span className="isl-hstate">{STATUS_WORDS[state]}</span>
                <span className="isl-htime">{relativeTime(chat.updatedAt, now)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="isl-hall" onClick={onAll}>
        {more > 0 ? `See all · ${more} more` : 'See all'}
      </button>
    </div>
  );
}
