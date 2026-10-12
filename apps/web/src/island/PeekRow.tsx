import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { waitingOnLabel, type ConversationSummary } from '@spark-outpost/contracts';
import { peekOffset, sessionState, type SessionState } from './island-model.ts';
import { sessionExpression } from './island-mood.ts';
import { SessionBlob, sessionTint } from './SessionBlob.tsx';

const STATUS_WORDS: Record<SessionState, string> = {
  working: 'working',
  waiting: 'needs you',
  done: 'done',
  failed: 'failed',
  idle: 'quiet',
};

const TIP_WORDS: Record<SessionState, string> = {
  working: 'Working…',
  waiting: 'Needs you',
  done: 'Done',
  failed: 'Failed',
  idle: 'Quiet',
};

function tipWord(chat: ConversationSummary, state: SessionState): string {
  const waitingOn = state === 'working' ? (chat.latestRun?.waitingOn ?? 0) : 0;
  return waitingOn > 0 ? waitingOnLabel(waitingOn) : TIP_WORDS[state];
}

const BADGES: Partial<Record<SessionState, string>> = {
  waiting: '!',
  failed: '!',
  done: '',
};

const LEAVE_MS = 420;

interface PeekRowProps {
  sessions: readonly ConversationSummary[];
  more: number;
  shown: boolean;
  size: number;
  clearance: number;
  sleepy: boolean;
  onOpen: (id: string) => void;
  onMore: () => void;
}

interface Slot {
  chat: ConversationSummary;
  leaving: boolean;
}

function useSlots(sessions: readonly ConversationSummary[]): Slot[] {
  const [leaving, setLeaving] = useState<ConversationSummary[]>([]);
  const previous = useRef<readonly ConversationSummary[]>(sessions);
  useEffect(() => {
    const ids = new Set(sessions.map((chat) => chat.id));
    const gone = previous.current.filter((chat) => !ids.has(chat.id));
    previous.current = sessions;
    if (gone.length === 0) return;
    setLeaving((list) => [...list, ...gone]);
    const timer = setTimeout(
      () => setLeaving((list) => list.filter((chat) => !gone.includes(chat))),
      LEAVE_MS,
    );
    return () => clearTimeout(timer);
  }, [sessions]);
  return [
    ...sessions.map((chat) => ({ chat, leaving: false })),
    ...leaving
      .filter((chat) => !sessions.some((live) => live.id === chat.id))
      .map((chat) => ({ chat, leaving: true })),
  ];
}

export function PeekRow({
  sessions,
  more,
  shown,
  size,
  clearance,
  sleepy,
  onOpen,
  onMore,
}: PeekRowProps) {
  const slots = useSlots(sessions);
  const [focus, setFocus] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const count = sessions.length + (more > 0 ? 1 : 0);
  const current = Math.min(focus, Math.max(0, count - 1));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = (current + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
    setFocus(next);
    buttons.current[next]?.focus();
  };

  if (slots.length === 0 && more === 0) return null;
  return (
    <div
      className="isl-peekrow"
      role="toolbar"
      aria-label="Active chats"
      data-shown={shown || undefined}
      onKeyDown={onKeyDown}
    >
      {slots.map(({ chat, leaving }, index) => {
        const state = sessionState(chat);
        const slot = leaving ? index : sessions.indexOf(chat);
        const label = `Chat: ${chat.title}, ${STATUS_WORDS[state]}`;
        return (
          <button
            key={chat.id}
            ref={(element) => {
              if (!leaving) buttons.current[slot] = element;
            }}
            type="button"
            className="isl-peekblob"
            data-chat={chat.id}
            data-state={state}
            data-leaving={leaving || undefined}
            tabIndex={!leaving && shown && slot === current ? 0 : -1}
            aria-label={label}
            disabled={leaving || !shown}
            style={
              {
                '--x': `${peekOffset(slot, clearance)}px`,
                '--d': `${slot * 70}ms`,
                '--sc': sessionTint(chat),
              } as CSSProperties
            }
            onClick={() => onOpen(chat.id)}
            onFocus={() => !leaving && setFocus(slot)}
          >
            <SessionBlob
              chat={chat}
              state={state}
              size={size}
              expression={sessionExpression(state, sleepy)}
            />
            {BADGES[state] !== undefined && (
              <span className="isl-pb" data-state={state} aria-hidden="true">
                {BADGES[state]}
              </span>
            )}
            <span className="isl-tip" aria-hidden="true">
              <b>{chat.title}</b>
              <span>
                <em data-state={state}>{tipWord(chat, state)}</em> · Click to open
              </span>
            </span>
          </button>
        );
      })}
      {more > 0 && (
        <button
          ref={(element) => {
            buttons.current[sessions.length] = element;
          }}
          type="button"
          className="isl-peekmore"
          tabIndex={shown && current === sessions.length ? 0 : -1}
          disabled={!shown}
          aria-label={`${more} more active chats`}
          style={
            {
              '--x': `${peekOffset(sessions.length, clearance)}px`,
              '--d': `${sessions.length * 70}ms`,
            } as CSSProperties
          }
          onClick={onMore}
        >
          +{more}
        </button>
      )}
    </div>
  );
}
