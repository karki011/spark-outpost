import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BrowserPaneTab, BrowserPick, BrowserProfile } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { requestChat } from '../app/chat-request.ts';
import { ChatView } from '../chat/ChatView.tsx';
import { ChatPaneContext, type ChatPane } from '../chat/split/chat-pane.ts';
import { ExternalLinkIcon, PlusIcon, XIcon } from '../ui/icons.tsx';
import { PageChatDock, type DockRequest } from './PageChatDock.tsx';
import { pageRef } from './page-intents.ts';
import { setTabChat, tabChatOf, useTabChats, type TabChat } from './tab-chats.ts';

const TAB_CHAT_INTRO =
  'This chat belongs to the tab beside it. Ask about the page or what to do next.';

function usePaneFocus(pane: RefObject<HTMLElement | null>): boolean {
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    const moved = (event: Event) => {
      setFocused(pane.current?.contains(event.target as Node) ?? false);
    };
    document.addEventListener('pointerdown', moved, true);
    document.addEventListener('focusin', moved, true);
    return () => {
      document.removeEventListener('pointerdown', moved, true);
      document.removeEventListener('focusin', moved, true);
    };
  }, [pane]);
  return focused;
}

function useLiveChat(chat: TabChat | null): string | null {
  const list = useQuery({ queryKey: queryKeys.conversations, queryFn: api.listConversations });
  if (!chat) return null;
  const listed = list.data?.find((candidate) => candidate.id === chat.chatId);
  if (listed) return listed.archivedAt === null ? chat.chatId : null;
  return list.dataUpdatedAt > chat.startedAt + 5_000 ? null : chat.chatId;
}

interface DockControlsProps {
  onNew(): void;
  onOpen(): void;
  onClose(): void;
}

function DockControls({ onNew, onOpen, onClose }: DockControlsProps) {
  return (
    <span className="bv-chat-controls">
      <button type="button" className="icon-btn" aria-label="New chat for this tab" onClick={onNew}>
        <PlusIcon />
      </button>
      <button type="button" className="icon-btn" aria-label="Open in Chats" onClick={onOpen}>
        <ExternalLinkIcon />
      </button>
      <button type="button" className="icon-btn" aria-label="Close chat" onClick={onClose}>
        <XIcon />
      </button>
    </span>
  );
}

interface TabChatDockProps {
  profile: BrowserProfile;
  tab: BrowserPaneTab | null;
  request: DockRequest;
  onFresh(): void;
  onRemovePick(pick: BrowserPick): void;
  onOpenChat(chatId: string): void;
  onClose(): void;
}

export function TabChatDock({
  profile,
  tab,
  request,
  onFresh,
  onRemovePick,
  onOpenChat,
  onClose,
}: TabChatDockProps) {
  const tabId = tab?.id ?? null;
  const chatId = useLiveChat(tabChatOf(useTabChats(), profile, tabId));
  const [composingFor, setComposingFor] = useState<string | null>(null);
  const composing = composingFor !== null && composingFor === (tabId ?? '');
  const setComposing = (on: boolean) => setComposingFor(on ? (tabId ?? '') : null);
  const pane = useRef<HTMLDivElement>(null);
  const focused = usePaneFocus(pane);
  const extras = request.selection !== null || request.link !== null || request.picks.length > 0;
  const shownPage = tab && tab.url !== '' && tab.error === null ? pageRef(profile, tab) : null;

  const chatPane = useMemo<ChatPane>(
    () => ({
      split: true,
      focused,
      idSuffix: '-tab-chat',
      name: 'Chat for this tab',
      landmark: 'section',
      intro: TAB_CHAT_INTRO,
      docked: true,
      closer: chatId ? (
        <DockControls
          onNew={() => setComposingFor(tabId ?? '')}
          onOpen={() => onOpenChat(chatId)}
          onClose={onClose}
        />
      ) : null,
    }),
    [focused, chatId, tabId, onOpenChat, onClose],
  );

  if (!chatId || composing || extras) {
    return (
      <PageChatDock
        key={`${tabId ?? ''}:${request.key}`}
        page={request.page === undefined ? shownPage : request.page}
        request={request}
        onStarted={(started) => {
          if (tabId !== null) setTabChat(profile, tabId, started);
          setComposing(false);
          onFresh();
        }}
        onBack={
          chatId
            ? () => {
                setComposing(false);
                onFresh();
              }
            : null
        }
        onRemovePick={onRemovePick}
        onClose={onClose}
      />
    );
  }
  return (
    <aside className="bv-chat" aria-label="Chat for this tab">
      <div ref={pane} className="bv-chat-pane">
        <ChatPaneContext value={chatPane}>
          <ChatView key={chatId} conversationId={chatId} onOpenChat={requestChat} />
        </ChatPaneContext>
      </div>
    </aside>
  );
}
