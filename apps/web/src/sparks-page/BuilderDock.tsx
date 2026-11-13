import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BuilderChat } from '@spark-outpost/contracts';
import { requestChat } from '../app/chat-request.ts';
import { formatClock } from '../calendar/clock-format.ts';
import { ChatView } from '../chat/ChatView.tsx';
import { ChatPaneContext, type ChatPane } from '../chat/split/chat-pane.ts';
import { hourCycle } from '../desktop/hour-cycle.ts';
import { CheckIcon, PlusIcon, XIcon } from '../ui/icons.tsx';
import { builderApi, builderKeys } from './builder-api.ts';

const DONE_POLL_MS = 10_000;

function useBuilderChat(chatId: string | null, onChat: (id: string | null) => void) {
  const client = useQueryClient();
  const current = useQuery({
    queryKey: builderKeys.current(chatId),
    queryFn: () => builderApi.current(chatId),
    refetchInterval: (query) => (query.state.data?.doneAt ? DONE_POLL_MS : false),
  });
  const keep = (chat: BuilderChat) => client.setQueryData(builderKeys.current(chatId), chat);
  const start = useMutation({
    mutationFn: builderApi.start,
    onSuccess: (chat) => {
      client.setQueryData(builderKeys.current(null), chat);
      onChat(null);
    },
  });
  const done = useMutation({ mutationFn: builderApi.done, onSuccess: keep });
  const startNew = start.mutate;
  const missing = chatId === null && current.isSuccess && current.data === null;
  useEffect(() => {
    if (missing) startNew(crypto.randomUUID());
  }, [missing, startNew]);
  return { current, start, done };
}

function useDockFocus(dock: React.RefObject<HTMLElement | null>) {
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    const away = (event: Event) => {
      setFocused(dock.current?.contains(event.target as Node) ?? false);
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('focusin', away, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('focusin', away, true);
    };
  }, [dock]);
  return focused;
}

function doneLine(chat: BuilderChat): string {
  const at = chat.removeAt ? formatClock(Date.parse(chat.removeAt), hourCycle()) : '';
  return `Done · removed tomorrow at ${at} unless you send another message`;
}

interface DockControlsProps {
  chat: BuilderChat;
  busy: boolean;
  onDone(): void;
  onNew(): void;
  onClose(): void;
}

function DockControls({ chat, busy, onDone, onNew, onClose }: DockControlsProps) {
  return (
    <span className="bld-controls">
      {chat.doneAt ? (
        <button type="button" className="btn sm" disabled={busy} onClick={onNew}>
          <PlusIcon /> New chat
        </button>
      ) : (
        <button type="button" className="btn sm" disabled={busy} onClick={onDone}>
          <CheckIcon /> Done
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label="Close builder chat"
        title="Close builder chat"
        onClick={onClose}
      >
        <XIcon />
      </button>
    </span>
  );
}

function Shell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <aside className="bld-dock" aria-label={label}>
      {children}
    </aside>
  );
}

interface BuilderDockProps {
  chatId: string | null;
  onChat(chatId: string | null): void;
  onClose(): void;
}

export function BuilderDock({ chatId, onChat, onClose }: BuilderDockProps) {
  const { current, start, done } = useBuilderChat(chatId, onChat);
  const dock = useRef<HTMLDivElement>(null);
  const focused = useDockFocus(dock);
  const chat = current.data ?? null;
  const busy = start.isPending || done.isPending;
  const markDone = done.mutate;
  const startNew = start.mutate;
  const pane = useMemo<ChatPane>(
    () => ({
      split: true,
      focused,
      idSuffix: '-builder',
      name: 'Builder chat',
      landmark: 'section',
      closer: chat ? (
        <DockControls
          chat={chat}
          busy={busy}
          onDone={() => markDone(chat.conversationId)}
          onNew={() => startNew(crypto.randomUUID())}
          onClose={onClose}
        />
      ) : null,
    }),
    [focused, chat, busy, markDone, startNew, onClose],
  );
  const problem = current.error ?? start.error ?? done.error;

  if (!chat) {
    return (
      <Shell label="Builder chat">
        <div className="bld-wait" aria-busy={!problem}>
          {problem ? (
            <p role="alert">{problem.message || 'The builder chat didn’t open.'}</p>
          ) : (
            <p>Opening the builder chat…</p>
          )}
          <button type="button" className="btn sm" onClick={onClose}>
            Close
          </button>
        </div>
      </Shell>
    );
  }
  return (
    <Shell label="Builder chat">
      <div ref={dock} className="bld-pane">
        {chat.doneAt && (
          <p className="bld-done" role="status">
            <CheckIcon /> {doneLine(chat)}
          </p>
        )}
        {done.error && (
          <p className="bld-problem" role="alert">
            {done.error.message}
          </p>
        )}
        <ChatPaneContext value={pane}>
          <ChatView
            key={chat.conversationId}
            conversationId={chat.conversationId}
            onOpenChat={requestChat}
          />
        </ChatPaneContext>
      </div>
    </Shell>
  );
}
