import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { FileIcon } from '../attachments/attachment-icons.tsx';
import { summaryChatView } from '../attachments/shared-chat.ts';
import { useProjects } from '../project/use-chat-repos.ts';

const SHOWN_MAX = 30;

interface ChatPickerProps {
  currentId: string;
  onPick: (chatId: string) => void;
  onClose: () => void;
}

function matching(
  chats: readonly ConversationSummary[],
  currentId: string,
  query: string,
): ConversationSummary[] {
  const needle = query.trim().toLowerCase();
  return chats
    .filter(
      (chat) =>
        chat.id !== currentId &&
        chat.archivedAt === null &&
        chat.title.toLowerCase().includes(needle),
    )
    .slice(0, SHOWN_MAX);
}

export function ChatPicker({ currentId, onPick, onClose }: ChatPickerProps) {
  const [query, setQuery] = useState('');
  const [wanted, setWanted] = useState(0);
  const chats = useQuery({ queryKey: queryKeys.conversations, queryFn: api.listConversations });
  const projects = useProjects();
  const listId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = matching(chats.data ?? [], currentId, query);
  const active = Math.min(wanted, Math.max(0, shown.length - 1));
  const names = new Map((projects.data ?? []).map((project) => [project.id, project.name]));
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    inputRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [listId, active]);

  const pick = (chat: ConversationSummary | undefined) => {
    if (!chat) return;
    onPick(chat.id);
    onClose();
  };

  return (
    <div
      ref={panelRef}
      className="mpop left filepop chatpop open"
      role="dialog"
      aria-label="Add another chat"
    >
      <input
        ref={inputRef}
        className="fsearch"
        type="search"
        role="combobox"
        aria-label="Search chats"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
        placeholder="Search chats by title"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setWanted(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            if (shown.length > 0) setWanted((active + step + shown.length) % shown.length);
          } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            pick(shown[active]);
          }
        }}
      />
      <div id={listId} className="flist" role="listbox" aria-label="Chats">
        {shown.map((chat, index) => {
          const view = summaryChatView(
            chat,
            chat.projectIds.flatMap((id) => names.get(id) ?? []),
          );
          return (
            <div
              key={chat.id}
              id={optionId(index)}
              className="fopt"
              role="option"
              aria-selected={index === active}
              title={`${view.title}\n${view.project} · ${view.state}`}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => {
                if (index !== active) setWanted(index);
              }}
              onClick={() => pick(chat)}
            >
              <FileIcon />
              <span className="fname">
                <b>{view.title}</b>
                <small>{view.project}</small>
              </span>
              <small>{view.state}</small>
            </div>
          );
        })}
      </div>
      {shown.length === 0 && !chats.isPending && <p className="mempty">No matching chats.</p>}
      <p className="eff-note">Read-only. The agent gets a short summary and can read more.</p>
    </div>
  );
}
