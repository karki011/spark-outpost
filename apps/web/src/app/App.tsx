import { useCallback, useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary, SetupState } from '@spark-outpost/contracts';
import { Analytics } from '../analytics/Analytics.tsx';
import { api, newDraftId, queryKeys } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { ChatView } from '../chat/ChatView.tsx';
import { StatusCompanion } from '../companion/StatusCompanion.tsx';
import { AgentTvHost } from '../crew/AgentTvHost.tsx';
import { scrollToChatApproval } from '../crew/scroll-to-anchor.ts';
import { ConversationList } from '../conversations/ConversationList.tsx';
import { attention, isRunning, rowState } from '../conversations/row-state.ts';
import { SidebarLayoutProvider, useSidebarLayoutState } from '../conversations/sidebar-layout.tsx';
import { Home } from '../home/Home.tsx';
import { Onboarding } from '../onboarding/Onboarding.tsx';
import { ResetHost } from '../reset/ResetHost.tsx';
import { SettingsDialog, type SettingsSection } from '../settings/SettingsDialog.tsx';
import { useSettingsRequests } from '../settings/settings-request.ts';
import { Tickets } from '../tickets/Tickets.tsx';
import { ticketKeys, ticketsApi } from '../tickets/tickets-api.ts';
import { BackOnlineToast } from './connection/BackOnlineToast.tsx';
import { markConnectionRestored, useConnection } from './connection/connection-store.ts';
import { OfflineScreen } from './connection/OfflineScreen.tsx';
import { ReconnectBanner } from './connection/ReconnectBanner.tsx';
import { LivePausedHint } from './live/LivePausedHint.tsx';
import { useAppEvents } from './live/use-app-events.ts';
import { Rail, type AppView } from './Rail.tsx';
import { readSavedView, saveView } from './saved-view.ts';
import { useAttentionTitle } from './use-attention-title.ts';
import '../ui/controls.css';

function ChatShell({ entering }: { entering: boolean }) {
  const queryClient = useQueryClient();
  const live = useAppEvents();
  const connection = useConnection();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState(newDraftId);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  useSettingsRequests(setSettings);
  const [view, setViewState] = useState<AppView>(readSavedView);
  const setView = useCallback((next: AppView) => {
    setViewState(next);
    saveView(next);
  }, []);
  const [homeDraftId, setHomeDraftId] = useState(newDraftId);
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const chats = conversations.data ?? [];
  const waiting = attention(chats, null).count;
  const inbox = useQuery({ queryKey: ticketKeys.inbox, queryFn: ticketsApi.inbox, enabled: false });
  const ticketsWaiting = (inbox.data?.tickets ?? []).filter(
    (ticket) => ticket.section === 'attention',
  ).length;
  const layout = useSidebarLayoutState(waiting > 0);
  useAttentionTitle(waiting);
  const finished = chats.some((chat) => rowState(chat, false).tone === 'done');
  const mood =
    waiting > 0 ? 'alert' : chats.some(isRunning) ? 'working' : finished ? 'happy' : null;

  const startDraft = () => {
    const next = newDraftId();
    setDraftId(next);
    setSelectedId(next);
    setView('chats');
    return next;
  };

  const startDraftInProject = (projectId: string) => {
    const next = startDraft();
    layout.closeDrawer();
    void api
      .updateChatSettings(next, { projectIds: [projectId] })
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.conversation(next) }));
  };

  const openChat = (id: string) => {
    setSelectedId(id);
    setView('chats');
    layout.closeDrawer();
  };

  const openAtCard = (chat: ConversationSummary) => {
    openChat(chat.id);
    scrollToChatApproval(chat);
  };

  const activeId =
    selectedId ??
    chats.find((chat) => !chat.archivedAt)?.id ??
    (conversations.data ? draftId : null);

  const classes = [
    'app',
    entering ? 'entering' : '',
    layout.collapsed && !layout.narrow ? 'collapsed' : '',
    layout.drawer ? 'drawer' : '',
  ].filter(Boolean);

  return (
    <SidebarLayoutProvider value={layout}>
      <div
        className={classes.join(' ')}
        style={layout.width ? ({ '--side-w': `${layout.width}px` } as CSSProperties) : undefined}
      >
        <Rail
          view={view}
          waiting={waiting}
          ticketsWaiting={ticketsWaiting}
          mood={mood}
          onView={(next) => {
            setView(next);
            if (next === 'chats' && layout.collapsed && !layout.narrow) layout.reveal();
          }}
          onSettings={() => setSettings('profile')}
          onProfile={() => setSettings('profile')}
        />
        <div className="view" hidden={view !== 'chats'}>
          <ConversationList
            selectedId={activeId}
            onSelect={setSelectedId}
            onNew={startDraft}
            onNewInProject={startDraftInProject}
          />
          <div className="scrim" aria-hidden="true" onClick={layout.closeDrawer} />
          {activeId ? (
            <ChatView key={activeId} conversationId={activeId} />
          ) : (
            <main className="main" aria-busy="true" />
          )}
        </div>
        {view === 'home' && (
          <Home
            chats={chats}
            mood={mood}
            draftId={homeDraftId}
            onOpenChat={openAtCard}
            onRotateDraft={setHomeDraftId}
            onOpenId={openChat}
            onChats={() => setView('chats')}
            onUsage={() => setSettings('usage')}
            onProviders={() => setSettings('ai')}
          />
        )}
        {view === 'analytics' && <Analytics />}
        {view === 'tickets' && <Tickets onOpenChat={openChat} />}
        {view === 'chats' && (
          <AgentTvHost
            activeId={activeId}
            onGoTo={(id) => {
              setSelectedId(id);
              layout.closeDrawer();
            }}
          />
        )}
        <StatusCompanion
          chats={chats}
          visible={view !== 'chats' || activeId === null}
          onOpenChat={openAtCard}
          onHome={() => setView('home')}
        />
        {live.paused && !connection.lost && <LivePausedHint />}
        <AnimatePresence>
          {settings && (
            <SettingsDialog
              key="settings"
              section={settings}
              onSection={setSettings}
              onClose={() => setSettings(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </SidebarLayoutProvider>
  );
}

export function App() {
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get, retry: false });
  const queryClient = useQueryClient();
  const connection = useConnection();
  const [entering, setEntering] = useState(false);

  function handleOnboardingFinished() {
    saveView('home');
    setEntering(true);
    setTimeout(() => setEntering(false), 250);
  }

  function restoreSetup(state: SetupState) {
    markConnectionRestored();
    queryClient.setQueryData(setupKey, state);
  }

  if (setup.data === undefined) {
    if (!setup.isError) return <div className="app" aria-hidden="true" />;
    return (
      <OfflineScreen
        error={setup.error}
        failedAt={setup.errorUpdatedAt}
        onRetry={setupApi.get}
        onBack={restoreSetup}
      />
    );
  }
  return (
    <>
      {setup.data.profile.onboardingCompleted ? (
        <ChatShell entering={entering} />
      ) : (
        <Onboarding onFinished={handleOnboardingFinished} />
      )}
      {connection.lost && <ReconnectBanner />}
      {connection.recoveries > 0 && <BackOnlineToast key={connection.recoveries} />}
      <ResetHost />
    </>
  );
}
