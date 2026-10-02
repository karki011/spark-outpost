import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { ACTIVE_MS, matchesQuery, sessionState, type Panel } from './island-model.ts';
import { sessionExpression } from './island-mood.ts';
import { PanelTabs } from './PanelTabs.tsx';
import { StateChip, projectLine } from './session-bits.tsx';
import { SessionBlob } from './SessionBlob.tsx';
import { SessionChat } from './SessionChat.tsx';

interface SessionsProps {
  chats: readonly ConversationSummary[];
  projectNames: ReadonlyMap<string, string>;
  selected: string | null;
  waiting: number;
  now: number;
  focusDelay: number;
  onSelect: (id: string | null) => void;
  onTab: (panel: Panel) => void;
  onOpenChat: (id: string) => void;
}

const GROUPS = [
  { id: 'needs', label: 'Needs you' },
  { id: 'running', label: 'Running' },
  { id: 'recent', label: 'Recent' },
  { id: 'earlier', label: 'Earlier' },
] as const;

function groupOf(chat: ConversationSummary, now: number): (typeof GROUPS)[number]['id'] {
  const state = sessionState(chat);
  if (state === 'waiting') return 'needs';
  if (state === 'working') return 'running';
  if (now - Date.parse(chat.updatedAt) <= ACTIVE_MS) return 'recent';
  return 'earlier';
}

const GROUP_RANK = new Map(GROUPS.map((group, index) => [group.id, index]));

function byGroup(chats: readonly ConversationSummary[], now: number): ConversationSummary[] {
  return chats.toSorted(
    (a, b) => GROUP_RANK.get(groupOf(a, now))! - GROUP_RANK.get(groupOf(b, now))!,
  );
}

function sessionGroups(chats: readonly ConversationSummary[], now: number) {
  const indexed = chats.map((chat, index) => ({ chat, index, group: groupOf(chat, now) }));
  return GROUPS.map((group) => ({
    ...group,
    chats: indexed.filter((item) => item.group === group.id),
  })).filter((group) => group.chats.length > 0);
}

export function Sessions(props: SessionsProps) {
  const { chats, projectNames, selected, onSelect } = props;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = byGroup(
    chats.filter((chat) => matchesQuery(chat, projectNames, query)),
    props.now,
  );
  const shown = matches;
  const current = Math.min(active, Math.max(0, shown.length - 1));
  const picked = selected ? chats.find((chat) => chat.id === selected) : undefined;

  useEffect(() => {
    if (picked) return;
    const timer = setTimeout(
      () => inputRef.current?.focus({ preventScroll: true }),
      props.focusDelay,
    );
    return () => clearTimeout(timer);
  }, [picked, props.focusDelay]);

  const activeId = shown[current]?.id;
  useEffect(() => {
    if (activeId)
      document.getElementById(`isl-sopt-${activeId}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = shown.length;
    if (event.key === 'ArrowDown' && count) setActive((current + 1) % count);
    else if (event.key === 'ArrowUp' && count) setActive((current - 1 + count) % count);
    else if (event.key === 'Enter' && count) onSelect(shown[current]!.id);
    else return;
    event.preventDefault();
  };

  return (
    <div className="isl-body">
      <PanelTabs panel="sessions" waiting={props.waiting} onTab={props.onTab} />
      {picked ? (
        <SessionChat
          chat={picked}
          projectNames={projectNames}
          onBack={() => onSelect(null)}
          onOpenChat={props.onOpenChat}
        />
      ) : (
        <>
          <div className="isl-search">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="m10.5 10.5 3 3"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <label className="sr-only" htmlFor="isl-squery">
              Search sessions
            </label>
            <input
              id="isl-squery"
              ref={inputRef}
              type="search"
              placeholder="Search sessions by title or project"
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="isl-slist"
              aria-activedescendant={shown[current] ? `isl-sopt-${shown[current].id}` : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          {shown.length > 0 ? (
            <div className="isl-slist" id="isl-slist" role="listbox" aria-label="Recent sessions">
              {sessionGroups(shown, props.now).map((group) => (
                <div
                  key={group.label}
                  role="group"
                  aria-labelledby={`isl-sg-${group.id}`}
                  className="isl-sgroup"
                >
                  <div id={`isl-sg-${group.id}`} className="isl-hhead" role="presentation">
                    {group.label}
                  </div>
                  {group.chats.map(({ chat, index }) => {
                    const state = sessionState(chat);
                    return (
                      <div
                        key={chat.id}
                        id={`isl-sopt-${chat.id}`}
                        role="option"
                        aria-selected={index === current}
                        className={index === current ? 'isl-srow act' : 'isl-srow'}
                        onClick={() => onSelect(chat.id)}
                      >
                        <SessionBlob
                          chat={chat}
                          state={state}
                          size={22}
                          expression={sessionExpression(state, false)}
                        />
                        <div className="isl-smain">
                          <div className="isl-st">{chat.title}</div>
                          <div className="isl-sp2">{projectLine(chat, projectNames)}</div>
                        </div>
                        <StateChip chat={chat} state={state} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="isl-sempty">
              {query ? `No session matches “${query}”.` : 'No chats yet.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
