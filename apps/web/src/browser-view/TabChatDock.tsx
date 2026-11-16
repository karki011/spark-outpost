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
import { claimTabChat, tabChatOf, useTabChats, type TabChat } from './tab-chats.ts';

const TAB_CHAT_INTRO =
  'This chat belongs to the tab beside it. Ask about the page or what to do next.';

function usePaneFocus(pane: RefObject<HTMLElement | null>): [boolean, (focused: boolean) => void] {
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    const moved = (event: Event) => {
      if (pane.current) setFocused(pane.current.contains(event.target as Node));
    };
    document.addEventListener('pointerdown', moved, true);
    document.addEventListener('focusin', moved, true);
    return () => {
      document.removeEventListener('pointerdown', moved, true);
      document.removeEventListener('focusin', moved, true);
    };
  }, [pane]);
  return [focused, setFocused];
}

function useLiveChat(chat: TabChat | null): string | null {
  const list = useQuery({ queryKey: queryKeys.conversations, queryFn: api.listConversations });
  const listed = chat ? list.data?.find((candidate) => candidate.id === chat.chatId) : undefined;
  const lookUp = chat !== null && list.data !== undefined && listed === undefined;
  const detail = useQuery({
    queryKey: queryKeys.conversation(chat?.chatId ?? ''),
    queryFn: () => api.getConversation(chat?.chatId ?? ''),
    enabled: lookUp,
    retry: false,
  });
  if (!chat) return null;
  const found = listed ?? (lookUp ? detail.data?.conversation : undefined);
  if (found) return found.archivedAt === null ? chat.chatId : null;
  if (lookUp && detail.isError) return null;
  return chat.chatId;
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
  const [focused, setFocused] = usePaneFocus(pane);
  const own = request.tabId === tabId;
  const extras =
    own && (request.selection !== null || request.link !== null || request.picks.length > 0);
  if (extras && chatId && !composing) setComposing(true);
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
        page={own && request.page !== undefined ? request.page : shownPage}
        request={own ? request : { ...request, selection: null, link: null, picks: [] }}
        onSend={() => {
          const claim = tabId === null ? null : claimTabChat(profile, tabId);
          return (started) => {
            if (claim && !claim(started)) return;
            setFocused(true);
            setComposing(false);
            onFresh();
          };
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
