import { useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SetupState } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { setupApi, setupKey } from '../api/setup.ts';
import { ChatView } from '../chat/ChatView.tsx';
import { AgentTvHost } from '../crew/AgentTvHost.tsx';
import { ConversationList } from '../conversations/ConversationList.tsx';
import { attention, isRunning, rowState } from '../conversations/row-state.ts';
import { SidebarLayoutProvider, useSidebarLayoutState } from '../conversations/sidebar-layout.tsx';
import { Onboarding } from '../onboarding/Onboarding.tsx';
import { SettingsDialog, type SettingsSection } from '../settings/SettingsDialog.tsx';
import { BackOnlineToast } from './connection/BackOnlineToast.tsx';
import { markConnectionRestored, useConnection } from './connection/connection-store.ts';
import { OfflineScreen } from './connection/OfflineScreen.tsx';
import { ReconnectBanner } from './connection/ReconnectBanner.tsx';
import { ComingSoon } from './ComingSoon.tsx';
import { Rail, type AppView } from './Rail.tsx';
import { useAttentionTitle } from './use-attention-title.ts';
import '../ui/controls.css';

function ChatShell({ entering }: { entering: boolean }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [view, setView] = useState<AppView>('chats');
  const conversations = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: api.listConversations,
  });
  const chats = conversations.data ?? [];
  const waiting = attention(chats, null).count;
  const layout = useSidebarLayoutState(waiting > 0);
  useAttentionTitle(waiting);
  const finished = chats.some((chat) => rowState(chat, false).tone === 'done');
  const mood =
    waiting > 0 ? 'alert' : chats.some(isRunning) ? 'working' : finished ? 'happy' : null;

  const startDraft = () => {
    const next = crypto.randomUUID();
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
          <ComingSoon
            title="Home is coming soon"
            text="A summary of what your chats are doing will live here."
            onChats={() => setView('chats')}
          />
        )}
        {view === 'tickets' && (
          <ComingSoon
            title="Tickets are coming soon"
            text="Track work from your issue tracker next to the chats that fix it."
            onChats={() => setView('chats')}
          />
        )}
        {view === 'chats' && (
          <AgentTvHost
            activeId={activeId}
            onGoTo={(id) => {
              setSelectedId(id);
              layout.closeDrawer();
            }}
          />
        )}
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
    </>
  );
}
