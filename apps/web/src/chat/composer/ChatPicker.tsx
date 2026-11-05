import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  shownChatTitle,
  type ChatShareState,
  type ConversationSummary,
  type TaskItemState,
} from '@spark-outpost/contracts';
import { api, queryKeys } from '../../api/client.ts';
import { TaskStateIcon } from '../../tasks/TaskIcons.tsx';
import '../../tasks/task-list.css';
import { FileIcon } from '../attachments/attachment-icons.tsx';
import {
  projectSummary,
  summaryChatView,
  type SharedChatTone,
} from '../attachments/shared-chat.ts';
import { useProjects } from '../project/use-chat-repos.ts';

const SHOWN_MAX = 30;

const stateIcons: Record<ChatShareState, TaskItemState> = {
  working: 'active',
  needs_you: 'waiting',
  failed: 'failed',
  done: 'done',
  idle: 'pending',
};

function stateIcon(tone: SharedChatTone): TaskItemState {
  return tone === 'archived' || tone === 'deleted' ? 'pending' : stateIcons[tone];
}

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
        shownChatTitle(chat.title).toLowerCase().includes(needle),
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
          const projectNames = chat.projectIds.flatMap((id) => names.get(id) ?? []);
          const view = summaryChatView(chat, projectNames);
          const summary = projectSummary(projectNames);
          return (
            <div
              key={chat.id}
              id={optionId(index)}
              className="fopt chatopt"
              role="option"
              aria-selected={index === active}
              aria-label={`${view.title}, ${view.project}, ${view.state}`}
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
                <small className="chat-proj">
                  <span>{summary.name}</span>
                  {summary.more && <span className="chat-proj-more">{summary.more}</span>}
                </small>
              </span>
              <span className="chat-state" data-tone={view.tone}>
                <span aria-hidden="true">
                  <TaskStateIcon state={stateIcon(view.tone)} />
                </span>
                {view.state}
              </span>
            </div>
          );
        })}
      </div>
      {shown.length === 0 && !chats.isPending && <p className="mempty">No matching chats.</p>}
      <p className="eff-note">Read-only. The agent gets a short summary and can read more.</p>
    </div>
  );
}
