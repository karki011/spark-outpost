import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationSummary, SetupState } from '@spark-outpost/contracts';
import { AnalyticsSkeleton } from '../analytics/AnalyticsSkeleton.tsx';
import { api, newDraftId, queryKeys } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { ChatView } from '../chat/ChatView.tsx';
import { queueDraft } from '../chat/composer/pending-draft.ts';
import { StatusCompanion } from '../companion/StatusCompanion.tsx';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { AgentTvHost } from '../crew/AgentTvHost.tsx';
import { JUMP_TRIES, scrollToAnchor, scrollToChatApproval } from '../crew/scroll-to-anchor.ts';
import { turnAnchor } from '../chat/outline/outline-model.ts';
import { ConversationList } from '../conversations/ConversationList.tsx';
import { attention, isRunning, rowState } from '../conversations/row-state.ts';
import { SidebarLayoutProvider, useSidebarLayoutState } from '../conversations/sidebar-layout.tsx';
import { useChatViewed } from '../conversations/use-chat-viewed.ts';
import { useMarkSeen } from '../conversations/use-mark-seen.ts';
import { OnScreenChat, onScreenChatId } from '../conversations/on-screen.ts';
import { isDocLinkOpen, leaveDocs, useDocLinks } from '../docs/doc-route.ts';
import { DocsSkeleton } from '../docs/DocsSkeleton.tsx';
import { Home } from '../home/Home.tsx';
import { Onboarding } from '../onboarding/Onboarding.tsx';
import { OutpostHost } from '../outposts/OutpostHost.tsx';
import { ResetHost } from '../reset/ResetHost.tsx';
import { SessionPaletteHost } from '../sessions/SessionPaletteHost.tsx';
import { SettingsDialog, type SettingsSection } from '../settings/SettingsDialog.tsx';
import { useSettingsRequests } from '../settings/settings-request.ts';
import {
  currentProviderRoute,
  leaveProviderRoute,
  onProviderRoute,
} from '../providers/provider-route.ts';
import { SHOW_ISLAND_LABEL } from '../settings/DesktopCompanionSetting.tsx';
import { requestSettingFocus } from '../settings/setting-focus.ts';
import { LEVEL_LABEL } from '../spark/LevelSetting.tsx';
import { requestFeedback } from '../help/feedback-request.ts';
import { DocsReachable } from '../ui/DocLink.tsx';
import { FreezeWhileHidden } from '../ui/FreezeWhileHidden.tsx';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { TicketsViewSkeleton } from '../tickets/TicketsViewSkeleton.tsx';
import { unseenNotices } from '../tickets/ticket-model.ts';
import { ticketKeys } from '../tickets/tickets-api.ts';
import { useTicketInbox } from '../tickets/use-ticket-inbox.ts';
import { useTicketRequests } from '../tickets/ticket-request.ts';
import { BackOnlineToast } from './connection/BackOnlineToast.tsx';
import { markConnectionRestored, useConnection } from './connection/connection-store.ts';
import { OfflineScreen } from './connection/OfflineScreen.tsx';
import { PauseBanner } from './pause/PauseBanner.tsx';
import { ReconnectBanner } from './connection/ReconnectBanner.tsx';
import { LivePausedHint } from './live/LivePausedHint.tsx';
import { useAppEvents } from './live/use-app-events.ts';
import { useFirstContent } from './first-content.ts';
import { Analytics, OutpostView, Phone, preloadView, Tickets, Today } from './lazy-views.tsx';
import { JoinShortcut } from '../calendar/JoinShortcut.tsx';
import { Rail, type AppView } from './Rail.tsx';
import { readSavedView, saveView } from './saved-view.ts';
import { TeammateHost } from '../teammates/TeammateHost.tsx';
import { DefaultLevelNotice } from '../spark/DefaultLevelNotice.tsx';
import { PasskeyOffer } from '../phone/PasskeyOffer.tsx';
import { openTeammateSheet } from '../teammates/teammate-store.ts';
import { useAttentionTitle } from './use-attention-title.ts';
import { useAttentionReport } from '../desktop/use-attention-report.ts';
import { useChatRequests } from './chat-request.ts';
import { useSlackPresence } from '../slack/use-slack-presence.ts';
import { useCloseSeenNotifications } from '../phone/close-seen-notifications.ts';
import { useNotificationChats } from '../phone/use-notification-chats.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { startIdleMotion } from './idle-motion.ts';
import '../ui/controls.css';
import { openTodayEvent, useTodayOpener } from '../calendar/today-request.ts';

const StableChatView = memo(ChatView);

const MapPage = lazy(() =>
  import('../map/MapPage.tsx').then((module) => ({ default: module.MapPage })),
);

const DocsPage = lazy(() =>
  import('../docs/DocsPage.tsx').then((module) => ({ default: module.DocsPage })),
);

function ChatShell({ entering }: { entering: boolean }) {
  const queryClient = useQueryClient();
  const live = useAppEvents();
  const connection = useConnection();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openOutpostId, setOpenOutpostId] = useState<string | null>(null);
  const [outpostJumpTo, setOutpostJumpTo] = useState<string | null>(null);
  const selectChat = useCallback((id: string) => {
    setSelectedId(id);
    setOpenOutpostId(null);
  }, []);
  const [draftId, setDraftId] = useState(newDraftId);
  const [settings, setSettingsState] = useState<SettingsSection | null>(() =>
    currentProviderRoute() ? 'ai' : null,
  );
  const setSettings = useCallback((next: SettingsSection | null) => {
    if (next !== 'ai') leaveProviderRoute();
    setSettingsState(next);
  }, []);
  useSettingsRequests(setSettings);
  useEffect(() => onProviderRoute(() => setSettingsState('ai')), []);
  const [storedView, setViewState] = useState<AppView>(() =>
    isDocLinkOpen() ? 'docs' : readSavedView(),
  );
  const setView = useCallback((next: AppView) => {
    setViewState(next);
    saveView(next);
    if (next !== 'docs') leaveDocs();
  }, []);
  useDocLinks(() => {
    setView('docs');
    setSettings(null);
  });
  const [homeDraftId, setHomeDraftId] = useState(newDraftId);
  const [ticketFocus, setTicketFocus] = useState<string | null>(null);
  const openTicket = useCallback(
    (itemId: string) => {
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
      setTicketFocus(itemId);
      setView('tickets');
    },
    [setView, queryClient],
  );
  useTicketRequests(openTicket);
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const chats = conversations.data ?? [];
  const waiting = attention(chats, null).count;
  const { inbox } = useTicketInbox();
  const ticketsWaiting = (inbox.data?.tickets ?? []).filter(
    (ticket) => ticket.section === 'attention',
  ).length;
  const ticketNotices = unseenNotices(inbox.data?.tickets ?? []);
  const layout = useSidebarLayoutState(waiting > 0);
  const { remote } = useRemoteClient();
  const hiddenView = (layout.narrow && storedView === 'map') || (remote && storedView === 'today');
  const view: AppView = hiddenView ? 'home' : storedView;
  useAttentionTitle(waiting);
  useAttentionReport(conversations.data);
  const finished = chats.some((chat) => rowState(chat, false).tone === 'done');
  const mood =
    waiting > 0 ? 'alert' : chats.some(isRunning) ? 'working' : finished ? 'happy' : null;

  const startDraft = useStableCallback(() => {
    const next = newDraftId();
    setDraftId(next);
    selectChat(next);
    setView('chats');
    return next;
  });

  const startDraftInProject = useStableCallback((projectId: string) => {
    const next = startDraft();
    layout.closeDrawer();
    void api
      .updateChatSettings(next, { projectIds: [projectId] })
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.conversation(next) }));
    return next;
  });

  const chatAboutFile = (projectId: string, path: string) => {
    queueDraft(startDraftInProject(projectId), `About \`${path}\`: `);
  };

  const openChat = useStableCallback((id: string) => {
    selectChat(id);
    setView('chats');
    layout.closeDrawer();
  });

  const openOutpost = useStableCallback((id: string, postId?: string) => {
    setOpenOutpostId(id);
    setOutpostJumpTo(postId ?? null);
    setView('chats');
    layout.closeDrawer();
  });

  const openFromDesktop = useRef(openChat);
  useEffect(() => {
    openFromDesktop.current = openChat;
  });
  useEffect(
    () =>
      sparkDesktop()?.onOpenChat((id, runId) => {
        openFromDesktop.current(id);
        if (runId) scrollToAnchor(turnAnchor(runId), JUMP_TRIES);
      }),
    [],
  );
  useChatRequests(openChat);
  const startCalendarChat = useStableCallback((text: string) => queueDraft(startDraft(), text));
  const showToday = useCallback(() => {
    setSettings(null);
    setView('today');
  }, [setSettings, setView]);
  useTodayOpener(showToday);
  useSlackPresence(remote);
  useNotificationChats(remote, openChat);
  useEffect(() => sparkDesktop()?.help?.onOpenFeedback(requestFeedback), []);
  useEffect(
    () =>
      sparkDesktop()?.onOpenSettings?.((target) => {
        if (target === 'sparks') {
          setSettings('sparks');
          return;
        }
        if (target === 'connectors') {
          setSettings('tools');
          return;
        }
        if (target === 'spark-new') {
          openTeammateSheet({ kind: 'create' });
          return;
        }
        if (target.startsWith('today:')) {
          openTodayEvent(target.slice('today:'.length));
          return;
        }
        if (target.startsWith('spark-edit:')) {
          openTeammateSheet({ kind: 'edit', id: target.slice('spark-edit:'.length) });
          return;
        }
        requestSettingFocus(SHOW_ISLAND_LABEL);
        setSettings('notifications');
      }),
    [setSettings],
  );

  const openAtCard = (chat: ConversationSummary) => {
    openChat(chat.id);
    scrollToChatApproval(chat);
  };

  const activeId =
    selectedId ??
    chats.find((chat) => !chat.archivedAt)?.id ??
    (conversations.data ? draftId : null);
  const onScreenId = onScreenChatId({
    chatsView: view === 'chats',
    outpostOpen: openOutpostId !== null,
    settingsOpen: settings !== null,
    activeId,
  });
  const viewedHere = useChatViewed(onScreenId);
  useMarkSeen(viewedHere ? onScreenId : null, chats);
  useCloseSeenNotifications(remote, chats, viewedHere ? onScreenId : null);

  const classes = [
    'app',
    entering ? 'entering' : '',
    layout.collapsed && !layout.narrow ? 'collapsed' : '',
    layout.drawer ? 'drawer' : '',
  ].filter(Boolean);

  return (
    <SidebarLayoutProvider value={layout}>
      <OutpostHost openOutpostId={openOutpostId} onOpenOutpost={openOutpost}>
        <div
          className={classes.join(' ')}
          style={layout.width ? ({ '--side-w': `${layout.width}px` } as CSSProperties) : undefined}
        >
          <Rail
            view={view}
            waiting={waiting}
            ticketsWaiting={ticketsWaiting}
            ticketNotices={ticketNotices}
            mood={mood}
            onIntent={preloadView}
            onView={(next) => {
              setView(next);
              if (next === 'chats' && layout.collapsed && !layout.narrow) layout.reveal();
            }}
            onSettings={() => setSettings('spark')}
            onProfile={() => setSettings('spark')}
          />
          <div className={openOutpostId ? 'view in-outpost' : 'view'} hidden={view !== 'chats'}>
            <FreezeWhileHidden hidden={view !== 'chats'}>
              <OnScreenChat.Provider value={onScreenId}>
                <ConversationList
                  selectedId={openOutpostId ? null : activeId}
                  onSelect={selectChat}
                  onNew={startDraft}
                  onNewInProject={startDraftInProject}
                />
              </OnScreenChat.Provider>
              <div className="scrim" aria-hidden="true" onClick={layout.closeDrawer} />
              <FreezeWhileHidden hidden={openOutpostId !== null}>
                {activeId ? (
                  <StableChatView key={activeId} conversationId={activeId} onOpenChat={openChat} />
                ) : (
                  <main className="main" aria-busy="true" />
                )}
              </FreezeWhileHidden>
              {openOutpostId && (
                <Suspense
                  fallback={<main className="main op" aria-label="Outpost" aria-busy="true" />}
                >
                  <OutpostView
                    key={openOutpostId}
                    id={openOutpostId}
                    jumpTo={outpostJumpTo}
                    onOpenChat={openChat}
                    onGone={() => setOpenOutpostId(null)}
                  />
                </Suspense>
              )}
            </FreezeWhileHidden>
          </div>
          {view === 'home' && (
            <Home
              chats={chats}
              loading={conversations.isPending}
              mood={mood}
              draftId={homeDraftId}
              onOpenChat={openAtCard}
              onRotateDraft={setHomeDraftId}
              onOpenId={openChat}
              onChats={() => setView('chats')}
              onTickets={(itemId) => {
                setTicketFocus(itemId);
                setView('tickets');
              }}
              onUsage={() => setSettings('usage')}
              onProviders={() => setSettings('ai')}
            />
          )}
          {view === 'today' && (
            <Suspense fallback={<main className="page" aria-label="Today" aria-busy="true" />}>
              <Today chats={chats} onStartChat={startCalendarChat} onOpenChat={openChat} />
            </Suspense>
          )}
          {view === 'analytics' && (
            <Suspense fallback={<AnalyticsSkeleton />}>
              <Analytics />
            </Suspense>
          )}
          {view === 'tickets' && (
            <Suspense fallback={<TicketsViewSkeleton />}>
              <Tickets
                focusId={ticketFocus}
                onOpenChat={openChat}
                onHome={() => {
                  setTicketFocus(null);
                  setView('home');
                }}
              />
            </Suspense>
          )}
          {view === 'map' && (
            <Suspense
              fallback={<main className="page" aria-label="Project map" aria-busy="true" />}
            >
              <MapPage onOpenInChat={chatAboutFile} />
            </Suspense>
          )}
          {view === 'docs' && (
            <Suspense fallback={<DocsSkeleton />}>
              <DocsPage />
            </Suspense>
          )}
          {view === 'phone' && (
            <Suspense
              fallback={<main className="page" aria-label="Remote control" aria-busy="true" />}
            >
              <Phone />
            </Suspense>
          )}
          {view === 'chats' && (
            <AgentTvHost
              activeId={openOutpostId ? null : activeId}
              onGoTo={(id) => {
                selectChat(id);
                layout.closeDrawer();
              }}
            />
          )}
          <StatusCompanion
            chats={chats}
            visible={!layout.narrow && view !== 'map' && (view !== 'chats' || activeId === null)}
            onOpenChat={openAtCard}
            onHome={() => setView('home')}
          />
          {live.paused && !connection.lost && <LivePausedHint />}
          <DefaultLevelNotice
            onSettings={() => {
              requestSettingFocus(LEVEL_LABEL);
              setSettings('chats');
            }}
          />
          <PasskeyOffer />
          <SessionPaletteHost onOpenChat={openChat} />
          <JoinShortcut remote={remote} onOpenEvent={openTodayEvent} />
          <TeammateHost />
          <AnimatePresence>
            {settings && (
              <SettingsDialog
                key="settings"
                section={settings}
                onSection={setSettings}
                onClose={() => setSettings(null)}
                onOpenChat={(id) => {
                  setSettings(null);
                  openChat(id);
                }}
              />
            )}
          </AnimatePresence>
        </div>
      </OutpostHost>
    </SidebarLayoutProvider>
  );
}

export function App() {
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get, retry: false });
  const queryClient = useQueryClient();
  const connection = useConnection();
  const [entering, setEntering] = useState(false);
  useEffect(() => startIdleMotion(), []);
  useFirstContent(setup.data !== undefined || setup.isError);

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
        <DocsReachable value>
          <ChatShell entering={entering} />
        </DocsReachable>
      ) : (
        <Onboarding onFinished={handleOnboardingFinished} />
      )}
      {connection.lost && <ReconnectBanner />}
      {!connection.lost && setup.data.profile.onboardingCompleted && <PauseBanner />}
      {connection.recoveries > 0 && <BackOnlineToast key={connection.recoveries} />}
      <ResetHost />
    </>
  );
}
