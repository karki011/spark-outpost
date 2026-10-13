import './session-palette.css';
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { SEARCH_DELAY_MS } from '../conversations/SidebarHeader.tsx';
import { wrapTabFocus } from '../ui/focus-trap.ts';
import { SearchIcon, XIcon } from '../ui/icons.tsx';
import { Keys } from '../ui/Keys.tsx';
import { countLabel } from '../ui/count-label.ts';
import { useDebouncedValue } from '../ui/use-debounced-value.ts';
import { PaletteRow } from './PaletteRow.tsx';
import { GROUP_TITLES, moveActive, paletteEntries, paletteSections } from './palette-model.ts';

const NO_CHATS: readonly ConversationSummary[] = [];
const MOVE_KEYS = ['↑', '↓'] as const;
const OPEN_KEYS = ['Enter'] as const;
const CLOSE_KEYS = ['Esc'] as const;

interface SessionPaletteProps {
  onOpenChat: (chatId: string) => void;
  onClose: () => void;
}

export function SessionPalette({ onOpenChat, onClose }: SessionPaletteProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(text);
  const searched = useDebouncedValue(deferred.trim(), SEARCH_DELAY_MS);
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const results = useQuery({
    queryKey: queryKeys.conversationSearch(searched),
    queryFn: ({ signal }) => api.searchConversations(searched, signal),
    enabled: searched !== '',
    placeholderData: keepPreviousData,
  });
  const projects = useProjects();
  const projectNames = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project.name])),
    [projects.data],
  );
  const loaded = conversations.data ?? NO_CHATS;
  const found = searched !== '' && deferred.trim() !== '' ? (results.data ?? NO_CHATS) : NO_CHATS;
  const entries = useMemo(
    () => paletteEntries(loaded, found, projectNames, deferred),
    [loaded, found, projectNames, deferred],
  );
  const sections = useMemo(() => paletteSections(entries), [entries]);
  const current = Math.min(active, Math.max(0, entries.length - 1));
  const optionId = (chatId: string) => `${id}-opt-${chatId}`;
  const activeEntry = entries[current];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!activeEntry) return;
    document.getElementById(`${id}-opt-${activeEntry.chat.id}`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [activeEntry, id]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(moveActive(current, event.key, entries.length));
      return;
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && activeEntry) {
      if ((event.target as HTMLElement).closest('button')) return;
      event.preventDefault();
      onOpenChat(activeEntry.chat.id);
      return;
    }
    wrapTabFocus(event, () => [
      ...(panelRef.current?.querySelectorAll<HTMLElement>('input, button') ?? []),
    ]);
  };

  return (
    <div
      className="sp"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="sp-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Sessions"
        onKeyDown={onKeyDown}
      >
        <div className="sp-head">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            className="sp-input"
            role="combobox"
            aria-label="Find a session"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={activeEntry ? optionId(activeEntry.chat.id) : undefined}
            placeholder="Find a session"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setActive(0);
            }}
          />
          <button type="button" className="icon-btn sp-close" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <p className="sr-only" role="status">
          {conversations.isPending ? 'Loading sessions' : countLabel(entries.length, 'session')}
        </p>
        <div className="sp-list" id={`${id}-list`} role="listbox" aria-label="Sessions">
          {sections.map((section) => (
            <ul key={section.group} role="group" aria-labelledby={`${id}-${section.group}`}>
              <li className="sp-group" id={`${id}-${section.group}`} role="presentation">
                {GROUP_TITLES[section.group]}
              </li>
              {section.entries.map(({ entry, index }) => (
                <PaletteRow
                  key={entry.chat.id}
                  id={optionId(entry.chat.id)}
                  entry={entry}
                  index={index}
                  active={index === current}
                  onPick={onOpenChat}
                  onHover={setActive}
                />
              ))}
            </ul>
          ))}
          {entries.length === 0 && !conversations.isPending && (
            <p className="sp-empty">
              {deferred.trim() === '' ? 'No sessions yet.' : 'No sessions match.'}
            </p>
          )}
        </div>
        <p className="sp-foot" aria-hidden="true">
          <Keys keys={MOVE_KEYS} /> move
          <Keys keys={OPEN_KEYS} /> open
          <Keys keys={CLOSE_KEYS} /> close
        </p>
      </div>
    </div>
  );
}
