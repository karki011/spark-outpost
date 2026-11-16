import '../browser/browser-pane.css';
import './browser-view.css';
import './browser-spaces.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  browserViewShortcutEventSchema,
  splitHolds,
  type BrowserProfile,
  type BrowserShortcut,
} from '@spark-outpost/contracts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';
import { isNewChatShortcut } from '../conversations/SidebarHeader.tsx';
import { useSidebarLayout } from '../conversations/sidebar-layout.tsx';
import { MAC } from '../ui/shortcuts.ts';
import { defaultBrowserUrl, openInDefaultBrowser } from '../browser/chat-links.ts';
import { chromeShortcut, runPaneShortcut, type PaneCommands } from '../browser/pane-shortcuts.ts';
import { tabLabel } from '../browser/tab-label.ts';
import {
  recheckNativePlacement,
  useNativePlacement,
  type PlaceView,
} from '../browser/use-view-placement.ts';
import { ProfileSwitch, profileNote } from './ProfileSwitch.tsx';
import { AskTabsDock } from './AskTabsDock.tsx';
import { CommandBar } from './CommandBar.tsx';
import type { BarAction, BarMode } from './command-bar-model.ts';
import type { DockRequest } from './PageChatDock.tsx';
import type { PageRef } from './page-chat.ts';
import { pageRef, usePageIntents, usePagePicks } from './page-intents.ts';
import { chromeSpaceIndex, tabsInCurrentSpace } from './spaces-model.ts';
import { TabChatDock } from './TabChatDock.tsx';
import { ViewArchived } from './ViewArchived.tsx';
import { ViewBar } from './ViewBar.tsx';
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

function useChatKey(toggle: () => void) {
  const latest = useRef(toggle);
  useEffect(() => {
    latest.current = toggle;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isNewChatShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}

interface BrowserViewProps {
  onOpenChat(chatId: string): void;
}

export function BrowserView({ onOpenChat }: BrowserViewProps) {
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
  const sidebar = useSidebarLayout();
  const sideHidden = sidebar?.browserHidden ?? false;

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
      tabId: tab?.id ?? null,
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
        : {
            key: Date.now(),
            tabId: tab?.id ?? null,
            page: null,
            selection: null,
            link: null,
            picks: [pick],
          },
    );
  });
  usePageIntents(profile, allTabs, (page, intent) =>
    openDock({ tabId: intent.tabId, page, selection: intent.selection, link: intent.link }),
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
      newChat: () => (dock ? setDock(null) : openDock()),
      askSpark: openAsk,
    });
  };
  useViewShortcuts(profile, runShortcut);
  const toggleChat = () => (dock ? setDock(null) : openDock());
  useChatKey(toggleChat);
  useEffect(recheckNativePlacement, [peek?.id, splitShown, shown?.id, sideHidden, dock, asking]);
  const askingForPage = useRef(false);
  useEffect(() => {
    if (!askingForPage.current || shown?.url !== '') return;
    askingForPage.current = false;
    setBar('here');
  }, [shown?.id, shown?.url]);

  const shownBlank = !shown || shown.url === '' || shown.error !== null;
  const outside = defaultBrowserUrl(tab?.url ?? null, window.location.origin);
  const barAction = (action: BarAction) => {
    if (action === 'ask_spark') openAsk();
    else if (action === 'new_chat') openDock();
    else if (action === 'copy_link' && tab)
      sendViewCommand(profile, { command: 'copy_url', tabId: tab.id });
    else if (action === 'default_browser' && outside) openInDefaultBrowser(outside);
  };

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
      <nav className="bv-side" aria-label="Browser" hidden={sideHidden}>
        <ProfileSwitch profile={profile} onChange={chooseProfile} />
        <p className="bv-note">{profileNote(profile)}</p>
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
        <ViewBar
          profile={profile}
          commands={commands}
          tab={tab}
          tabs={tabs}
          shown={shown}
          splitShown={splitShown}
          peeking={peek !== null}
          outside={outside}
          sideHidden={sideHidden}
          chatOpen={dock !== null}
          onToggleSide={() => sidebar?.toggleBrowser()}
          onToggleChat={toggleChat}
          onNewSplitPage={() => {
            askingForPage.current = true;
          }}
          onNotice={setProblem}
        />
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
        <TabChatDock
          profile={profile}
          tab={tab}
          request={dock}
          onFresh={() =>
            setDock(
              (open) =>
                open && {
                  key: open.key,
                  tabId: tab?.id ?? null,
                  selection: null,
                  link: null,
                  picks: [],
                },
            )
          }
          onRemovePick={(pick) =>
            setDock((open) => open && { ...open, picks: open.picks.filter((p) => p !== pick) })
          }
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
