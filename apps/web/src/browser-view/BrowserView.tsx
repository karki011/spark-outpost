import '../browser/browser-pane.css';
import './browser-view.css';
import './browser-spaces.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserViewShortcutEventSchema,
  parseBrowserUrl,
  splitHolds,
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
import {
  recheckNativePlacement,
  useNativePlacement,
  type PlaceView,
} from '../browser/use-view-placement.ts';
import { ProfileBadge, ProfileSwitch, profileNote } from './ProfileSwitch.tsx';
import { setBrowserPaneOpen } from '../browser/pane-open.ts';
import { AskTabsDock } from './AskTabsDock.tsx';
import { CommandBar } from './CommandBar.tsx';
import type { BarAction, BarMode } from './command-bar-model.ts';
import { HandToChat } from './HandToChat.tsx';
import { PageChatDock, type DockRequest } from './PageChatDock.tsx';
import type { PageRef } from './page-chat.ts';
import { pageRef, usePageIntents, usePagePicks } from './page-intents.ts';
import { ViewSelect } from './ViewSelect.tsx';
import { chromeSpaceIndex, tabsInCurrentSpace } from './spaces-model.ts';
import { ViewArchived } from './ViewArchived.tsx';
import { SplitButton } from './SplitButton.tsx';
import { PeekPanel, SplitStage, StartPage } from './ViewStage.tsx';
import { ViewFavorites } from './ViewFavorites.tsx';
import { ViewDownloads } from './ViewDownloads.tsx';
import { ViewSpaces } from './ViewSpaces.tsx';
import { ViewTabs } from './ViewTabs.tsx';
import {
  acceptViewState,
  chooseProfile,
  clearLinkProblem,
  sendViewCommand,
  useChosenProfile,
  useLinkProblem,
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
  const {
    tabs: allTabs,
    favorites,
    layout,
    snapshot,
    split,
    peek,
    slotImages,
  } = useProfileTabs(profile);
  const tabs = tabsInCurrentSpace(allTabs, layout);
  const [ownProblem, setProblem] = useState<string | null>(null);
  const linkProblem = useLinkProblem();
  const problem = ownProblem ?? linkProblem;
  const shown = tabs.find((candidate) => candidate.active) ?? null;
  const tab = peek ?? shown;
  const splitShown = split !== null && splitHolds(split, shown?.id ?? null);
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
    setDock({
      key: Date.now(),
      page: shownPage(),
      selection: null,
      link: null,
      picks: [],
      ...change,
    });
  };
  const openAsk = () => {
    setDock(null);
    setAsking({ key: Date.now(), first: shownPage() });
  };
  usePagePicks(profile, (pick) => {
    setAsking(null);
    setDock((open) =>
      open
        ? { ...open, picks: [...open.picks, pick] }
        : { key: Date.now(), page: null, selection: null, link: null, picks: [pick] },
    );
  });
  usePageIntents(profile, allTabs, (page, intent) =>
    openDock({ page, selection: intent.selection, link: intent.link }),
  );
  const [bar, setBar] = useState<BarMode | null>(null);
  const runShortcut = (shortcut: BrowserShortcut) => {
    if (shortcut === 'new_tab' || shortcut === 'focus_address') {
      setBar(shortcut === 'new_tab' ? 'new' : 'here');
      return;
    }
    const keyTabs = peek ? [{ ...peek, active: true }] : tabs;
    runPaneShortcut(commands, keyTabs, shortcut, {
      focusAddress,
      openFind: () => undefined,
      copiedUrl: () => undefined,
      newChat: () => openDock(),
      askSpark: openAsk,
    });
  };
  useViewShortcuts(profile, runShortcut);
  useEffect(recheckNativePlacement, [peek?.id, splitShown, shown?.id]);
  const askingForPage = useRef(false);
  useEffect(() => {
    if (!askingForPage.current || shown?.url !== '') return;
    askingForPage.current = false;
    setBar('here');
  }, [shown?.id, shown?.url]);

  const act = (command: 'back' | 'forward' | 'reload' | 'stop') => {
    if (tab) sendViewCommand(profile, { command, tabId: tab.id });
  };
  const blank = !tab || tab.url === '' || tab.error !== null;
  const shownBlank = !shown || shown.url === '' || shown.error !== null;
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
        const spaceIndex = chromeSpaceIndex(event, MAC);
        if (spaceIndex !== null) {
          const space = layout.spaces[spaceIndex];
          event.preventDefault();
          event.stopPropagation();
          if (space) sendViewCommand(profile, { command: 'space_switch', id: space.id });
          return;
        }
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
        <ViewSpaces profile={profile} layout={layout} />
        <ViewTabs
          profile={profile}
          tabs={tabs}
          layout={layout}
          split={split}
          onNewTab={() => setBar('new')}
        />
        <ViewArchived profile={profile} layout={layout} />
        <ViewDownloads />
      </nav>
      <main className="page bv-page" id="bv-page" aria-label={tab ? tabLabel(tab) : 'Browser'}>
        <div className="bv-bar">
          <ProfileBadge profile={profile} />
          <PageHost url={tab?.url ?? ''} />
          {tab?.picking ? (
            <span className="bv-title" role="status">
              Click to select, ⇧ click for more, ↑↓ parent or child, drag a box. Esc finishes.
            </span>
          ) : (
            <span className="bv-title">{tab && tab.url !== '' ? tabLabel(tab) : ''}</span>
          )}
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
          <ViewSelect profile={profile} tab={tab} disabled={blank} />
          <PageTools tab={tab} commands={commands} onNotice={setProblem} />
          <SplitButton
            profile={profile}
            tabs={tabs}
            shown={shown}
            inSplit={splitShown}
            disabled={peek !== null || shown === null}
            onNewPage={() => {
              askingForPage.current = true;
            }}
          />
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
            <button
              type="button"
              className="bp-link"
              onClick={() => {
                setProblem(null);
                clearLinkProblem();
              }}
            >
              Dismiss
            </button>
          </p>
        )}
        <div className="bv-stage">
          <div className="bp-view bv-view" ref={viewRef}>
            {splitShown ? (
              <SplitStage profile={profile} split={split} tabs={tabs} images={slotImages} />
            ) : (
              <>
                {shownBlank && <StartPage profile={profile} tab={shown} />}
                {!shownBlank && snapshot && <img className="bp-snapshot" src={snapshot} alt="" />}
              </>
            )}
          </div>
          {peek && <PeekPanel profile={profile} tab={peek} image={slotImages[peek.id] ?? null} />}
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
          onRemovePick={(pick) =>
            setDock((open) => open && { ...open, picks: open.picks.filter((p) => p !== pick) })
          }
          onClose={() => setDock(null)}
        />
      )}
      {bar && (
        <CommandBar
          key={bar}
          profile={profile}
          mode={bar}
          tab={tab}
          tabs={allTabs}
          favorites={favorites}
          archived={layout.archived}
          onOpenArchived={(id) => sendViewCommand(profile, { command: 'archived_open', id })}
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
