import '../browser/browser-pane.css';
import './browser-view.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserViewShortcutEventSchema,
  parseBrowserUrl,
  type BrowserPaneTab,
  type BrowserProfile,
  type BrowserShortcut,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';
import { ChatPlusIcon, ExternalLinkIcon, LockIcon, SparkleIcon } from '../ui/icons.tsx';
import { ASK_TABS_KEYS, keysText, NEW_CHAT_KEYS } from '../ui/Keys.tsx';
import { MAC } from '../ui/shortcuts.ts';
import { AddressBar } from '../browser/AddressBar.tsx';
import {
  DevtoolsIcon,
  NavBackIcon,
  NavForwardIcon,
  ReloadIcon,
  StopIcon,
} from '../browser/BrowserIcons.tsx';
import { defaultBrowserUrl, openInDefaultBrowser } from '../browser/chat-links.ts';
import {
  PANE_KEYS,
  chromeShortcut,
  runPaneShortcut,
  type PaneCommands,
} from '../browser/pane-shortcuts.ts';
import { PageTools, ZoomBadge } from '../browser/PageTools.tsx';
import { tabLabel } from '../browser/tab-label.ts';
import { ToolButton } from '../browser/ToolButton.tsx';
import { useNativePlacement, type PlaceView } from '../browser/use-view-placement.ts';
import { ProfileBadge, ProfileSwitch, profileNote } from './ProfileSwitch.tsx';
import { setBrowserPaneOpen } from '../browser/pane-open.ts';
import { AskTabsDock } from './AskTabsDock.tsx';
import { CommandBar } from './CommandBar.tsx';
import type { BarAction, BarMode } from './command-bar-model.ts';
import { HandToChat } from './HandToChat.tsx';
import { PageChatDock, type DockRequest } from './PageChatDock.tsx';
import type { PageRef } from './page-chat.ts';
import { pageRef, usePageIntents } from './page-intents.ts';
import { ViewFavorites } from './ViewFavorites.tsx';
import { ViewDownloads } from './ViewDownloads.tsx';
import { ViewTabs } from './ViewTabs.tsx';
import {
  acceptViewState,
  chooseProfile,
  sendViewCommand,
  useChosenProfile,
  useProfileTabs,
} from './view-store.ts';

function viewCommands(profile: BrowserProfile): PaneCommands {
  return {
    send: (command) => sendViewCommand(profile, command),
    close: (tabId) => sendViewCommand(profile, { command: 'close', tabId }),
    ask: async (command) => desktopBrowserView()?.command(profile, command),
  };
}

function useViewShortcuts(profile: BrowserProfile, run: (shortcut: BrowserShortcut) => void) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    const view = desktopBrowserView();
    if (!view) return;
    return view.onShortcut((raw) => {
      const event = browserViewShortcutEventSchema.safeParse(raw);
      if (event.success && event.data.profile === profile) latest.current(event.data.shortcut);
    });
  }, [profile]);
}

function StartPage({ profile, tab }: { profile: BrowserProfile; tab: BrowserPaneTab | null }) {
  if (tab?.error) {
    return (
      <div className="bp-start" role="status">
        <b>This page didn’t load</b>
        <p>{tab.error}</p>
      </div>
    );
  }
  return (
    <div className="bp-start">
      <b>{profile === 'personal' ? 'Personal browser' : 'Work browser'}</b>
      <p>Type a web address on the left to open a page.</p>
      <p>
        {profile === 'personal'
          ? 'No agent, Ask Spark or paired device can open or act in these tabs, and your sign-ins here stay out of every chat. Ask Spark reads a tab’s text only when you @-mention it in a question.'
          : 'Work shares its sign-ins with every chat’s agent, so you can sign in for them or check what they see. Agents still can’t see these tabs until you hand one to a chat.'}
      </p>
    </div>
  );
}

function PageHost({ url }: { url: string }) {
  const parsed = parseBrowserUrl(url);
  if (!parsed || url === '') return null;
  return (
    <span className="bv-host" title={url}>
      {parsed.protocol === 'https:' && <LockIcon />}
      {parsed.host || parsed.pathname}
    </span>
  );
}

const NEW_CHAT_ARIA = MAC ? 'Meta+Shift+O' : 'Control+Shift+O';
const ASK_TABS_ARIA = MAC ? 'Alt+Meta+A' : 'Control+Alt+A';

interface BrowserViewProps {
  chats: readonly ConversationSummary[];
  onOpenChat(chatId: string): void;
}

export function BrowserView({ chats, onOpenChat }: BrowserViewProps) {
  const profile = useChosenProfile();
  const { tabs, favorites, snapshot } = useProfileTabs(profile);
  const [problem, setProblem] = useState<string | null>(null);
  const tab = tabs.find((candidate) => candidate.active) ?? null;
  const viewRef = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const commands = viewCommands(profile);

  const place = useCallback<PlaceView>(
    (bounds, covered) => void desktopBrowserView()?.place({ profile, bounds, covered }),
    [profile],
  );
  useNativePlacement(viewRef, true, place);

  useEffect(() => {
    void desktopBrowserView()?.start(profile).then(acceptViewState);
  }, [profile]);

  const focusAddress = () => {
    const address = root.current?.querySelector<HTMLInputElement>('input.bp-url');
    address?.focus();
    address?.select();
  };
  const [dock, setDock] = useState<DockRequest | null>(null);
  const [asking, setAsking] = useState<{ key: number; first: PageRef | null } | null>(null);
  const shownPage = () =>
    tab && tab.url !== '' && tab.error === null ? pageRef(profile, tab) : null;
  const openDock = (change: Partial<DockRequest> = {}) => {
    setAsking(null);
    setDock({ key: Date.now(), page: shownPage(), selection: null, link: null, ...change });
  };
  const openAsk = () => {
    setDock(null);
    setAsking({ key: Date.now(), first: shownPage() });
  };
  usePageIntents(profile, tabs, (page, intent) =>
    openDock({ page, selection: intent.selection, link: intent.link }),
  );
  const [bar, setBar] = useState<BarMode | null>(null);
  const runShortcut = (shortcut: BrowserShortcut) => {
    if (shortcut === 'new_tab' || shortcut === 'focus_address') {
      setBar(shortcut === 'new_tab' ? 'new' : 'here');
      return;
    }
    runPaneShortcut(commands, tabs, shortcut, {
      focusAddress,
      openFind: () => undefined,
      copiedUrl: () => undefined,
      newChat: () => openDock(),
      askSpark: openAsk,
    });
  };
  useViewShortcuts(profile, runShortcut);

  const act = (command: 'back' | 'forward' | 'reload' | 'stop') => {
    if (tab) sendViewCommand(profile, { command, tabId: tab.id });
  };
  const blank = !tab || tab.url === '' || tab.error !== null;
  const outside = defaultBrowserUrl(tab?.url ?? null, window.location.origin);
  const barAction = (action: BarAction) => {
    if (action === 'ask_spark') openAsk();
    else if (action === 'new_chat') openDock();
    else if (action === 'copy_link' && tab)
      sendViewCommand(profile, { command: 'copy_url', tabId: tab.id });
    else if (action === 'default_browser' && outside) openInDefaultBrowser(outside);
  };
  const tabKey = `${profile}:${tab?.id ?? ''}:${tab?.url ?? ''}`;

  return (
    <div
      ref={root}
      className="bv"
      onKeyDown={(event) => {
        const shortcut = chromeShortcut(event);
        if (!shortcut) return;
        event.preventDefault();
        event.stopPropagation();
        runShortcut(shortcut);
      }}
    >
      <nav className="bv-side" aria-label="Browser">
        <div className="bv-nav">
          <ToolButton
            label="Back"
            keys={PANE_KEYS.back}
            disabled={!tab?.canGoBack}
            onClick={() => act('back')}
          >
            <NavBackIcon />
          </ToolButton>
          <ToolButton
            label="Forward"
            keys={PANE_KEYS.forward}
            disabled={!tab?.canGoForward}
            onClick={() => act('forward')}
          >
            <NavForwardIcon />
          </ToolButton>
          {tab?.loading ? (
            <ToolButton label="Stop loading" onClick={() => act('stop')}>
              <StopIcon />
            </ToolButton>
          ) : (
            <ToolButton
              label="Reload"
              keys={PANE_KEYS.reload}
              disabled={blank}
              onClick={() => act('reload')}
            >
              <ReloadIcon />
            </ToolButton>
          )}
        </div>
        <ProfileSwitch profile={profile} onChange={chooseProfile} />
        <p className="bv-note">{profileNote(profile)}</p>
        <AddressBar key={tabKey} commands={commands} tab={tab} placeholder="Type a web address" />
        <ViewFavorites profile={profile} favorites={favorites} tab={tab} />
        <ViewTabs profile={profile} tabs={tabs} onNewTab={() => setBar('new')} />
        <ViewDownloads />
      </nav>
      <main className="page bv-page" id="bv-page" aria-label={tab ? tabLabel(tab) : 'Browser'}>
        <div className="bv-bar">
          <ProfileBadge profile={profile} />
          <PageHost url={tab?.url ?? ''} />
          <span className="bv-title">{tab && tab.url !== '' ? tabLabel(tab) : ''}</span>
          <ZoomBadge tab={tab} commands={commands} />
          <button
            type="button"
            className="btn bv-hand"
            aria-keyshortcuts={ASK_TABS_ARIA}
            title={`Ask Spark about your tabs (${keysText(ASK_TABS_KEYS)})`}
            onClick={openAsk}
          >
            <SparkleIcon />
            Ask Spark
          </button>
          <button
            type="button"
            className="btn bv-hand"
            aria-keyshortcuts={NEW_CHAT_ARIA}
            title={`Start a chat about this page (${keysText(NEW_CHAT_KEYS)})`}
            onClick={() => openDock()}
          >
            <ChatPlusIcon />
            New chat
          </button>
          <HandToChat
            profile={profile}
            tab={tab}
            chats={chats}
            onHanded={(chatId) => {
              setProblem(null);
              setBrowserPaneOpen(chatId, true);
              onOpenChat(chatId);
            }}
            onProblem={setProblem}
          />
          <PageTools tab={tab} commands={commands} onNotice={setProblem} />
          <ToolButton
            label="Open developer tools (⌥⌘I)"
            disabled={blank}
            onClick={() => tab && sendViewCommand(profile, { command: 'devtools', tabId: tab.id })}
          >
            <DevtoolsIcon />
          </ToolButton>
          <ToolButton
            label="Open in default browser"
            disabled={outside === null}
            onClick={() => outside && openInDefaultBrowser(outside)}
          >
            <ExternalLinkIcon />
          </ToolButton>
        </div>
        {problem && (
          <p className="bv-problem" role="alert">
            <span>{problem}</span>
            <button type="button" className="bp-link" onClick={() => setProblem(null)}>
              Dismiss
            </button>
          </p>
        )}
        <div className="bp-view bv-view" ref={viewRef}>
          {blank && <StartPage profile={profile} tab={tab} />}
          {!blank && snapshot && <img className="bp-snapshot" src={snapshot} alt="" />}
        </div>
      </main>
      {dock && (
        <PageChatDock
          key={dock.key}
          request={dock}
          onOpenChat={(chatId) => {
            setDock(null);
            onOpenChat(chatId);
          }}
          onClose={() => setDock(null)}
        />
      )}
      {bar && (
        <CommandBar
          key={bar}
          profile={profile}
          mode={bar}
          tab={tab}
          tabs={tabs}
          favorites={favorites}
          onSelectTab={(tabId) => sendViewCommand(profile, { command: 'select', tabId })}
          onOpen={(url, newTab) =>
            sendViewCommand(
              profile,
              newTab || !tab
                ? { command: 'new_tab', url }
                : { command: 'navigate', tabId: tab.id, url },
            )
          }
          onAction={barAction}
          onClose={() => setBar(null)}
        />
      )}
      {asking && (
        <AskTabsDock
          key={asking.key}
          first={asking.first}
          onOpenAssistant={onOpenChat}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}
