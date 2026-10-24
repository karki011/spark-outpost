import './browser-pane.css';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { BrowserPaneTab } from '@spark-outpost/contracts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import {
  DevtoolsIcon,
  GlobeIcon,
  NavBackIcon,
  NavForwardIcon,
  PickElementIcon,
  PickRegionIcon,
  ReloadIcon,
  StopIcon,
} from './BrowserIcons.tsx';
import {
  acceptBrowserState,
  activeTab,
  dismissAgentOpened,
  sendBrowserCommand,
  setPaneNotice,
  useChatBrowser,
} from './browser-store.ts';
import { browserViewAvailable, openChatTabInView } from '../browser-view/view-store.ts';
import { AddressBar } from './AddressBar.tsx';
import { ToolButton } from './ToolButton.tsx';
import { BrowserTabs } from './BrowserTabs.tsx';
import { FindBar } from './FindBar.tsx';
import { HandoffBanner } from './HandoffBanner.tsx';
import { defaultBrowserUrl, openInDefaultBrowser } from './chat-links.ts';
import {
  PANE_KEYS,
  chatPaneCommands,
  chromeShortcut,
  runPaneShortcut,
  usePageShortcuts,
} from './pane-shortcuts.ts';
import { PageWidthMenu } from './PageWidthMenu.tsx';
import { PreviewBadge, PreviewStart } from './PreviewControls.tsx';
import { tabLabel } from './tab-label.ts';
import { hiddenPlacement, useViewPlacement, type BrowserHome } from './use-view-placement.ts';

const COPIED_MS = 1600;
const REFOCUS_MS = 1500;

interface BrowserPaneProps {
  home: BrowserHome;
  shown: boolean;
  lead?: ReactNode;
  trail?: ReactNode;
  setWidth?: ((width: number) => void) | null;
}

function StartPage({ chatId, tab }: { chatId: string; tab: BrowserPaneTab | null }) {
  if (tab?.error) {
    return (
      <div className="bp-start">
        <div role="status">
          <b>This page didn’t load</b>
          <p>{tab.error}</p>
          <p>If it is your dev server, start it in the terminal, then reload.</p>
        </div>
        <PreviewStart chatId={chatId} tab={tab} />
      </div>
    );
  }
  return (
    <div className="bp-start">
      <b>Browser</b>
      <p>
        Type an address above to open a page. Your dev server works: try localhost and its port.
      </p>
      <PreviewStart chatId={chatId} tab={tab} />
      <p>
        Agents can open pages here, local or on the web, and click and type on them while you watch.
        Anything a page says is treated as untrusted.
      </p>
    </div>
  );
}

function isDevtoolsKey(event: KeyboardEvent<HTMLElement>): boolean {
  return (
    event.altKey && (event.metaKey || event.ctrlKey) && !event.shiftKey && event.code === 'KeyI'
  );
}

function AgentTabNote({ chatId, tab }: { chatId: string; tab: BrowserPaneTab }) {
  if (tab.pinned) return null;
  if (tab.kept) {
    return (
      <span className="bp-agent-life" role="status">
        Kept open until you close it
      </span>
    );
  }
  return (
    <span className="bp-agent-life" role="group" aria-label="Agent tab">
      <span>Closes when this turn ends</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        className="bp-link"
        onClick={() => sendBrowserCommand(chatId, { command: 'pin', tabId: tab.id, pinned: true })}
      >
        Pin to keep
      </button>
    </span>
  );
}

export function BrowserPane({
  home,
  shown,
  lead = null,
  trail = null,
  setWidth = null,
}: BrowserPaneProps) {
  const { chatId } = home;
  const browser = useChatBrowser(chatId);
  const view = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const tab = activeTab(browser);
  const started = useRef(false);
  const [finding, setFinding] = useState<{ tabId: string; request: number } | null>(null);
  const [copied, setCopied] = useState(0);
  useViewPlacement(view, home, shown);

  useEffect(() => {
    if (copied === 0) return;
    const timer = setTimeout(() => setCopied(0), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const shortcutUi = {
    focusAddress: () => {
      const address = section.current?.querySelector<HTMLInputElement>('input.bp-url');
      address?.focus();
      address?.select();
    },
    openFind: () => {
      if (tab) setFinding((open) => ({ tabId: tab.id, request: (open?.request ?? 0) + 1 }));
    },
    copiedUrl: () => setCopied((count) => count + 1),
  };
  const runShortcut = (shortcut: Parameters<typeof runPaneShortcut>[2]) =>
    runPaneShortcut(chatPaneCommands(chatId), browser.tabs, shortcut, shortcutUi);
  usePageShortcuts(chatId, runShortcut, shown);
  const shortcutAt = useRef(0);
  const tabKey = `${tab?.id ?? ''}:${tab?.url ?? ''}`;

  useEffect(() => {
    const recent = Date.now() - shortcutAt.current < REFOCUS_MS;
    if (!recent || document.activeElement !== document.body) return;
    section.current?.querySelector<HTMLInputElement>('input.bp-url')?.focus();
  }, [tabKey]);

  useEffect(() => {
    if (!shown || started.current) return;
    started.current = true;
    void desktopBrowser()?.start(hiddenPlacement(home)).then(acceptBrowserState);
  }, [shown, home]);

  const act = (command: 'back' | 'forward' | 'reload' | 'stop') => {
    if (tab) sendBrowserCommand(chatId, { command, tabId: tab.id });
  };
  const pick = (mode: 'element' | 'region') => {
    if (!tab) return;
    sendBrowserCommand(chatId, {
      command: 'pick',
      tabId: tab.id,
      mode: tab.picking ? 'off' : mode,
    });
  };
  const blank = !tab || tab.url === '' || tab.error !== null;
  const outside = defaultBrowserUrl(tab?.url ?? null, window.location.origin);
  const agentTab = browser.tabs.find((candidate) => candidate.id === browser.agentOpened) ?? null;
  const destination = home.sendsTo === 'terminal' ? 'the terminal' : 'the chat';

  return (
    <section
      ref={section}
      className="bp"
      aria-label="Browser"
      onKeyDown={(event) => {
        const shortcut = chromeShortcut(event);
        if (shortcut) {
          event.preventDefault();
          event.stopPropagation();
          shortcutAt.current = Date.now();
          runShortcut(shortcut);
          return;
        }
        if (!tab || blank || !isDevtoolsKey(event)) return;
        event.preventDefault();
        sendBrowserCommand(chatId, { command: 'devtools', tabId: tab.id });
      }}
    >
      <div className="bp-head">
        {lead}
        <BrowserTabs chatId={chatId} tabs={browser.tabs} />
        <span className="bp-head-status" aria-live="polite">
          {tab?.driving && <span className="bp-badge drive">Spark is driving</span>}
        </span>
        {trail}
      </div>
      <div className="bp-bar">
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
        {tab?.picking ? (
          <p className="bp-picking" role="status">
            Click or drag a box. Esc cancels.
          </p>
        ) : (
          <AddressBar key={tabKey} commands={chatPaneCommands(chatId)} tab={tab} />
        )}
        <ToolButton
          label={tab?.picking ? 'Stop selecting' : `Select an element for ${destination}`}
          disabled={blank}
          pressed={tab?.picking ?? false}
          onClick={() => pick('element')}
        >
          <PickElementIcon />
        </ToolButton>
        <ToolButton
          label={`Select a region for ${destination}`}
          disabled={blank || (tab?.picking ?? false)}
          onClick={() => pick('region')}
        >
          <PickRegionIcon />
        </ToolButton>
        <ToolButton
          label="Open developer tools (⌥⌘I)"
          disabled={blank}
          onClick={() => tab && sendBrowserCommand(chatId, { command: 'devtools', tabId: tab.id })}
        >
          <DevtoolsIcon />
        </ToolButton>
        {setWidth && (
          <PageWidthMenu setWidth={setWidth} onNotice={(notice) => setPaneNotice(chatId, notice)} />
        )}
        <ToolButton
          label="Open in default browser"
          disabled={outside === null}
          onClick={() => outside && openInDefaultBrowser(outside)}
        >
          <ExternalLinkIcon />
        </ToolButton>
        {browserViewAvailable() && (
          <ToolButton
            label="Open in Browser view (Work)"
            disabled={blank}
            onClick={() => {
              if (!tab) return;
              void openChatTabInView(chatId, tab.id).then((result) => {
                if (!result.ok) setPaneNotice(chatId, result.reason);
              });
            }}
          >
            <GlobeIcon />
          </ToolButton>
        )}
      </div>
      {finding && tab && finding.tabId === tab.id && !blank && (
        <FindBar
          chatId={chatId}
          tabId={tab.id}
          request={finding.request}
          onClose={() => {
            setFinding(null);
            sendBrowserCommand(chatId, { command: 'focus', tabId: tab.id });
          }}
        />
      )}
      <div className="bp-status" aria-live="polite">
        {copied > 0 && (
          <span className="bp-copied" role="status">
            Copied URL
          </span>
        )}
        {browser.notice && (
          <span className="bp-notice" role="alert">
            <span>{browser.notice}</span>
            <button type="button" className="bp-link" onClick={() => setPaneNotice(chatId, null)}>
              Dismiss
            </button>
          </span>
        )}
        {agentTab && (
          <span className="bp-agent-opened" role="group" aria-label="Opened by the agent">
            <span className="bp-badge drive">The agent opened {tabLabel(agentTab)}</span>
            <button type="button" className="bp-link" onClick={() => dismissAgentOpened(chatId)}>
              Dismiss
            </button>
          </span>
        )}
        {tab?.owner === 'agent' && tab.url !== '' && <AgentTabNote chatId={chatId} tab={tab} />}
        {tab?.owner === 'agent' && tab.lastAction && (
          <span className="bp-agent-did" role="status">
            Agent: {tab.lastAction}
          </span>
        )}
        <PreviewBadge chatId={chatId} />
      </div>
      {tab?.handoff && <HandoffBanner key={tab.handoff.approvalId} handoff={tab.handoff} />}
      <div className="bp-view" id="bp-view" ref={view}>
        {blank && <StartPage chatId={chatId} tab={tab} />}
        {!blank && browser.snapshot && (
          <img className="bp-snapshot" src={browser.snapshot} alt="" />
        )}
      </div>
    </section>
  );
}
