import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
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
import { ChatPanes } from '../chat/split/ChatPanes.tsx';
import { useChatSplit } from '../chat/split/use-chat-split.ts';
import { queueDraft } from '../chat/composer/pending-draft.ts';
import { StatusCompanion } from '../companion/StatusCompanion.tsx';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { AgentTvHost } from '../crew/AgentTvHost.tsx';
import { JUMP_TRIES, scrollToAnchor, scrollToChatApproval } from '../crew/scroll-to-anchor.ts';
import { turnAnchor } from '../chat/outline/outline-model.ts';
import { ConversationList } from '../conversations/ConversationList.tsx';
import { attention, isRunning, rowState } from '../conversations/row-state.ts';
import { SidebarLayoutProvider, useSidebarLayoutState } from '../conversations/sidebar-layout.tsx';
import { useSeenChats } from '../conversations/use-chat-viewed.ts';
import { OnScreenChat, onScreenChatIds } from '../conversations/on-screen.ts';
import { isDocLinkOpen, leaveDocs, useDocLinks } from '../docs/doc-route.ts';
import { DocsSkeleton } from '../docs/DocsSkeleton.tsx';
import { Home } from '../home/Home.tsx';
import { OutpostHost } from '../outposts/OutpostHost.tsx';
import { ResetHost } from '../reset/ResetHost.tsx';
import { SessionPaletteHost } from '../sessions/SessionPaletteHost.tsx';
import { useSettingsState } from '../settings/use-settings-state.ts';
import { useAppMenu } from '../desktop/use-app-menu.ts';
import { LEVEL_LABEL } from '../settings/setting-labels.ts';
import { requestSettingFocus } from '../settings/setting-focus.ts';
import { DocsReachable } from '../ui/DocLink.tsx';
import { FreezeWhileHidden } from '../ui/FreezeWhileHidden.tsx';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { useOutpostRoute } from './use-outpost-route.ts';
import { TicketsViewSkeleton } from '../tickets/TicketsViewSkeleton.tsx';
import { unseenNotices } from '../tickets/ticket-model.ts';
import { attentionCount } from '../tickets/ticket-optimistic.ts';
import { ticketKeys } from '../tickets/tickets-api.ts';
import { useTicketInbox } from '../tickets/use-ticket-inbox.ts';
import { useTicketRequests } from '../tickets/ticket-request.ts';
import { FullDiskAccessPrompt } from '../settings/FullDiskAccessPrompt.tsx';
import { BackOnlineToast } from './connection/BackOnlineToast.tsx';
import { markConnectionRestored, useConnection } from './connection/connection-store.ts';
import { OfflineScreen } from './connection/OfflineScreen.tsx';
import { PauseBanner } from './pause/PauseBanner.tsx';
import { ReconnectBanner } from './connection/ReconnectBanner.tsx';
import { LivePausedHint } from './live/LivePausedHint.tsx';
import { useAppEvents } from './live/use-app-events.ts';
import { useFirstContent } from './first-content.ts';
import {
  Analytics,
  BrowserView,
  Onboarding,
  OutpostView,
  Phone,
  preloadSettings,
  preloadView,
  SettingsDialog,
  Tickets,
  Today,
} from './lazy-views.tsx';
import { JoinShortcut } from '../calendar/JoinShortcut.tsx';
import { Rail, type AppView } from './Rail.tsx';
import { readSavedView, saveView } from './saved-view.ts';
import { readHomeDraftId, saveHomeDraftId } from '../home/home-draft.ts';
import { TeammateHost } from '../teammates/TeammateHost.tsx';
import { DefaultLevelNotice } from '../spark/DefaultLevelNotice.tsx';
import { PasskeyOffer } from '../phone/PasskeyOffer.tsx';
import { useAttentionTitle } from './use-attention-title.ts';
import { useAlertingChats } from '../attention/use-attention.ts';
import { useAttentionReport } from '../desktop/use-attention-report.ts';
import { useChatRequests } from './chat-request.ts';
import { useSlackPresence } from '../slack/use-slack-presence.ts';
import { focusCardFromNotification } from '../chat/status/focus-pending.ts';
import { useNotificationChats } from '../phone/use-notification-chats.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { useChatRetention } from './chat-retention.ts';
import { startIdleMotion } from './idle-motion.ts';
import { useDesktopSettingsOpener } from './use-desktop-settings-opener.ts';
import '../ui/controls.css';
import { openTodayEvent, useTodayOpener } from '../calendar/today-request.ts';
import {
  browserViewAvailable,
  useBrowserViewOpener,
  useLinksToView,
} from '../browser-view/view-store.ts';

const NO_IDS: readonly string[] = [];

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
  const { route: outpost, show: showOutpost, close: closeOutpost } = useOutpostRoute();
  const openOutpostId = outpost?.id ?? null;
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const split = useChatSplit(conversations.data);
  const showInPane = split.show;
  const selectChat = useCallback(
    (id: string) => {
      showInPane(id);
      closeOutpost();
    },
    [showInPane, closeOutpost],
  );
  const [draftId, setDraftId] = useState(newDraftId);
  const [settings, setSettings] = useSettingsState();
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
  const [homeDraftId, setHomeDraftId] = useState(readHomeDraftId);
  const rotateHomeDraft = useCallback((next: string) => {
    saveHomeDraftId(next);
    setHomeDraftId(next);
  }, []);
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
  const chats = conversations.data ?? [];
  const alerting = useAlertingChats();
  const waiting = attention(chats, [], alerting).count;
  const { inbox } = useTicketInbox();
  const ticketsWaiting = attentionCount(inbox.data);
  const ticketNotices = unseenNotices(inbox.data?.tickets ?? []);
  const layout = useSidebarLayoutState(waiting > 0);
  const { remote } = useRemoteClient();
  const hiddenView =
    (layout.narrow && (storedView === 'map' || storedView === 'browser')) ||
    (remote && storedView === 'today') ||
    (storedView === 'browser' && (remote || !browserViewAvailable()));
  const view: AppView = hiddenView ? 'home' : storedView;
  useAttentionTitle(waiting);
  useAttentionReport(conversations.data);
  useAppMenu({ sidebarShown: !layout.hidden });
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

  const openOutpost = useStableCallback((id: string, postId?: string, thread?: boolean) => {
    showOutpost(id, postId, thread);
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
  const showBrowserView = useCallback(() => {
    setSettings(null);
    setView('browser');
  }, [setSettings, setView]);
  useBrowserViewOpener(showBrowserView);
  useSlackPresence(remote);
  const openFromNotification = useStableCallback((chatId: string, cardId: string | null) => {
    setSettings(null);
    openChat(chatId);
    if (cardId) focusCardFromNotification(cardId);
  });
  useNotificationChats(remote, openFromNotification);
  useDesktopSettingsOpener(setSettings);

  const openAtCard = (chat: ConversationSummary) => {
    openChat(chat.id);
    scrollToChatApproval(chat);
  };

  const activeId =
    split.primary ??
    chats.find((chat) => !chat.archivedAt)?.id ??
    (conversations.data ? draftId : null);
  const besideId = activeId ? split.secondary : null;
  const shownIds = useMemo(
    () => [activeId, besideId].filter((id): id is string => id !== null),
    [activeId, besideId],
  );
  const onScreenIds = onScreenChatIds({
    chatsView: view === 'chats',
    outpostOpen: openOutpostId !== null,
    settingsOpen: settings !== null,
    shownIds,
  });
  const listedIds = openOutpostId ? NO_IDS : shownIds;
  useChatRetention(split.focus === 'secondary' ? besideId : activeId);
  useSeenChats(onScreenIds, chats, remote);
  const openBeside = useStableCallback((id: string) => {
    split.openBeside(id, activeId);
    closeOutpost();
    setView('chats');
  });

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
            onSettingsIntent={preloadSettings}
            onView={(next) => {
              setView(next);
              if (next === 'chats' && layout.collapsed && !layout.narrow) layout.reveal();
            }}
            onSettings={() => setSettings('spark')}
            onProfile={() => setSettings('spark')}
          />
          <div className={openOutpostId ? 'view in-outpost' : 'view'} hidden={view !== 'chats'}>
            <FreezeWhileHidden hidden={view !== 'chats'}>
              <OnScreenChat.Provider value={onScreenIds}>
                <ConversationList
                  selectedIds={listedIds}
                  onSelect={selectChat}
                  onOpenBeside={split.canSplit ? openBeside : null}
                  onLeave={split.leave}
                  onNew={startDraft}
                  onNewInProject={startDraftInProject}
                />
              </OnScreenChat.Provider>
              <div className="scrim" aria-hidden="true" onClick={layout.closeDrawer} />
              <FreezeWhileHidden hidden={openOutpostId !== null}>
                {activeId ? (
                  <ChatPanes primary={activeId} control={split} onOpenChat={openChat} />
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
                    jumpTo={outpost?.jumpTo}
                    openThread={outpost?.thread}
                    onOpenChat={openChat}
                    onGone={closeOutpost}
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
              onRotateDraft={rotateHomeDraft}
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
          {view === 'browser' && (
            <Suspense fallback={<main className="page" aria-label="Browser" aria-busy="true" />}>
              <BrowserView chats={chats} onOpenChat={openChat} />
            </Suspense>
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
              <MapPage onOpenInChat={chatAboutFile} onOpenChat={openChat} />
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
            visible={
              !layout.narrow &&
              view !== 'map' &&
              view !== 'browser' &&
              (view !== 'chats' || activeId === null)
            }
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
              <Suspense key="settings" fallback={null}>
                <SettingsDialog
                  section={settings}
                  onSection={setSettings}
                  onClose={() => setSettings(null)}
                  onOpenChat={(id) => {
                    setSettings(null);
                    openChat(id);
                  }}
                />
              </Suspense>
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
  useLinksToView();
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
          <FullDiskAccessPrompt />
        </DocsReachable>
      ) : (
        <Suspense fallback={<div className="app" aria-hidden="true" />}>
          <Onboarding onFinished={handleOnboardingFinished} />
        </Suspense>
      )}
      {connection.lost && <ReconnectBanner />}
      {!connection.lost && setup.data.profile.onboardingCompleted && <PauseBanner />}
      {connection.recoveries > 0 && <BackOnlineToast key={connection.recoveries} />}
      <ResetHost />
    </>
  );
}
