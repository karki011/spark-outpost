import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { ACTIVE_MS, matchesQuery, sessionState } from './island-model.ts';
import { sessionExpression } from './island-mood.ts';
import { StateChip, projectLine } from './session-bits.tsx';
import { SessionBlob } from './SessionBlob.tsx';
import { SessionChat } from './SessionChat.tsx';

interface SessionsProps {
  chats: readonly ConversationSummary[];
  projectNames: ReadonlyMap<string, string>;
  selected: string | null;
  now: number;
  focusDelay: number;
  onSelect: (id: string | null) => void;
  onOpenChat: (id: string) => void;
}

const PAGE = 60;

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

interface Listed {
  chat: ConversationSummary;
  index: number;
}

function arrange(chats: readonly ConversationSummary[], now: number, limit: number) {
  const tagged = chats.map((chat) => ({ chat, group: groupOf(chat, now) }));
  const ordered = GROUPS.flatMap((group) => tagged.filter((item) => item.group === group.id));
  const visible = ordered.slice(0, limit);
  const groups = GROUPS.map((group) => ({
    ...group,
    chats: [] as Listed[],
  }));
  visible.forEach((item, index) => {
    groups.find((group) => group.id === item.group)!.chats.push({ chat: item.chat, index });
  });
  return {
    shown: visible.map((item) => item.chat),
    hidden: ordered.length - visible.length,
    groups: groups.filter((group) => group.chats.length > 0),
  };
}

interface SessionRowProps {
  chat: ConversationSummary;
  active: boolean;
  now: number;
  projectNames: ReadonlyMap<string, string>;
  onSelect: (id: string) => void;
}

const SessionRow = memo(function SessionRow({
  chat,
  active,
  now,
  projectNames,
  onSelect,
}: SessionRowProps) {
  const state = sessionState(chat);
  return (
    <div
      id={`isl-sopt-${chat.id}`}
      role="option"
      aria-selected={active}
      className={active ? 'isl-srow act' : 'isl-srow'}
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
      <StateChip chat={chat} state={state} now={now} />
    </div>
  );
});

export function Sessions(props: SessionsProps) {
  const { chats, projectNames, selected, onSelect } = props;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [limit, setLimit] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);
  const arranged = useMemo(
    () =>
      arrange(
        chats.filter((chat) => matchesQuery(chat, projectNames, deferredQuery)),
        props.now,
        limit,
      ),
    [chats, projectNames, deferredQuery, props.now, limit],
  );
  const { shown } = arranged;
  const current = Math.min(active, Math.max(0, shown.length - 1));
  const listed = selected ? chats.find((chat) => chat.id === selected) : undefined;
  const unlisted = useQuery({
    queryKey: queryKeys.conversation(selected ?? 'none'),
    queryFn: () => api.getConversation(selected!),
    enabled: selected !== null && listed === undefined,
  });
  const picked = listed ?? (selected ? unlisted.data?.conversation : undefined);
  const loading = selected !== null && picked === undefined && !unlisted.isError;

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
    <div className="isl-panel">
      {picked ? (
        <SessionChat
          chat={picked}
          projectNames={projectNames}
          onBack={() => onSelect(null)}
          onOpenChat={props.onOpenChat}
        />
      ) : loading ? (
        <div className="isl-detail" aria-busy="true">
          <button type="button" className="isl-back" onClick={() => onSelect(null)}>
            ‹ Chats
          </button>
          <p className="sr-only" role="status">
            Opening the chat…
          </p>
          <div className="isl-skl" aria-hidden="true">
            <i />
            <i />
            <i style={{ width: '58%' }} />
          </div>
        </div>
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
                setLimit(PAGE);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          {shown.length > 0 ? (
            <>
              <div className="isl-slist" id="isl-slist" role="listbox" aria-label="Recent sessions">
                {arranged.groups.map((group) => (
                  <div
                    key={group.label}
                    role="group"
                    aria-labelledby={`isl-sg-${group.id}`}
                    className="isl-sgroup"
                  >
                    <div id={`isl-sg-${group.id}`} className="isl-hhead" role="presentation">
                      {group.label}
                    </div>
                    {group.chats.map(({ chat, index }) => (
                      <SessionRow
                        key={chat.id}
                        chat={chat}
                        active={index === current}
                        now={props.now}
                        projectNames={projectNames}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                ))}
              </div>
              {arranged.hidden > 0 && (
                <button type="button" className="isl-smore" onClick={() => setLimit(limit + PAGE)}>
                  Show {Math.min(PAGE, arranged.hidden)} more
                </button>
              )}
            </>
          ) : (
            <div className="isl-sempty">
              {deferredQuery ? `No session matches “${deferredQuery}”.` : 'No chats yet.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
