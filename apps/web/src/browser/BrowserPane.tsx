import './browser-pane.css';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { addressToUrl, type BrowserPaneTab } from '@spark-outpost/contracts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { ExternalLinkIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import {
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
import { BrowserTabs } from './BrowserTabs.tsx';
import { defaultBrowserUrl, openInDefaultBrowser } from './chat-links.ts';
import { PreviewBadge, PreviewStart } from './PreviewControls.tsx';
import { tabLabel } from './tab-label.ts';
import { hiddenPlacement, useViewPlacement, type BrowserHome } from './use-view-placement.ts';

interface BrowserPaneProps {
  home: BrowserHome;
  shown: boolean;
  lead?: ReactNode;
  trail?: ReactNode;
}

interface ToolButtonProps {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick(): void;
  children: ReactNode;
}

function ToolButton({ label, disabled = false, pressed, onClick, children }: ToolButtonProps) {
  const tip = useTooltip(label, { side: 'top' });
  return (
    <>
      <button
        type="button"
        className="icon-btn bp-tool"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        {...tip.triggerProps}
        onClick={onClick}
      >
        {children}
      </button>
      {tip.tooltip}
    </>
  );
}

function AddressBar({ chatId, tab }: { chatId: string; tab: BrowserPaneTab | null }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const url = tab?.url ?? '';

  useEffect(() => {
    if (tab && tab.url === '' && !tab.loading) input.current?.focus();
  }, [tab?.id, tab?.url, tab?.loading, tab]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed = draft ?? url;
    if (!addressToUrl(typed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (tab) sendBrowserCommand(chatId, { command: 'navigate', tabId: tab.id, url: typed });
    else sendBrowserCommand(chatId, { command: 'new_tab', url: typed });
    input.current?.blur();
  };

  return (
    <form className="bp-address" onSubmit={submit}>
      <input
        ref={input}
        className="inp bp-url"
        type="text"
        inputMode="url"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        aria-label="Address"
        aria-invalid={invalid}
        aria-describedby={invalid ? 'bp-address-error' : undefined}
        placeholder="localhost:5173 or a web address"
        value={draft ?? url}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDraft(null);
        }}
      />
      {invalid && (
        <p id="bp-address-error" className="bp-address-error" role="alert">
          Type a web address, like localhost:5173 or example.com.
        </p>
      )}
    </form>
  );
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

export function BrowserPane({ home, shown, lead = null, trail = null }: BrowserPaneProps) {
  const { chatId } = home;
  const browser = useChatBrowser(chatId);
  const view = useRef<HTMLDivElement>(null);
  const tab = activeTab(browser);
  const started = useRef(false);
  useViewPlacement(view, home, shown);

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
    <section className="bp" aria-label="Browser">
      <div className="bp-head">
        {lead}
        <BrowserTabs chatId={chatId} tabs={browser.tabs} />
        <span className="bp-head-status" aria-live="polite">
          {tab?.driving && <span className="bp-badge drive">Spark is driving</span>}
        </span>
        {trail}
      </div>
      <div className="bp-bar">
        <ToolButton label="Back" disabled={!tab?.canGoBack} onClick={() => act('back')}>
          <NavBackIcon />
        </ToolButton>
        <ToolButton label="Forward" disabled={!tab?.canGoForward} onClick={() => act('forward')}>
          <NavForwardIcon />
        </ToolButton>
        {tab?.loading ? (
          <ToolButton label="Stop loading" onClick={() => act('stop')}>
            <StopIcon />
          </ToolButton>
        ) : (
          <ToolButton label="Reload" disabled={blank} onClick={() => act('reload')}>
            <ReloadIcon />
          </ToolButton>
        )}
        {tab?.picking ? (
          <p className="bp-picking" role="status">
            Click or drag a box. Esc cancels.
          </p>
        ) : (
          <AddressBar key={`${tab?.id ?? ''}:${tab?.url ?? ''}`} chatId={chatId} tab={tab} />
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
          label="Open in default browser"
          disabled={outside === null}
          onClick={() => outside && openInDefaultBrowser(outside)}
        >
          <ExternalLinkIcon />
        </ToolButton>
      </div>
      <div className="bp-status" aria-live="polite">
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
        {tab?.owner === 'agent' && tab.lastAction && (
          <span className="bp-agent-did" role="status">
            Agent: {tab.lastAction}
          </span>
        )}
        <PreviewBadge chatId={chatId} />
      </div>
      <div className="bp-view" id="bp-view" ref={view}>
        {blank && <StartPage chatId={chatId} tab={tab} />}
        {!blank && browser.snapshot && (
          <img className="bp-snapshot" src={browser.snapshot} alt="" />
        )}
      </div>
    </section>
  );
}
