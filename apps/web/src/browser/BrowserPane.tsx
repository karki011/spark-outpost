import './browser-pane.css';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { addressToUrl, type BrowserPaneTab } from '@spark-outpost/contracts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { PinIcon, PlusIcon, SpinnerIcon, UnpinIcon } from '../ui/icons.tsx';
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
  sendBrowserCommand,
  useChatBrowser,
} from './browser-store.ts';
import { tabLabel } from './tab-label.ts';
import { useViewPlacement, type BrowserHome } from './use-view-placement.ts';

interface BrowserPaneProps {
  home: BrowserHome;
  shown: boolean;
}

interface ToolButtonProps {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick(): void;
  children: React.ReactNode;
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

function TabStrip({ chatId, tabs }: { chatId: string; tabs: readonly BrowserPaneTab[] }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0 || tabs.length === 0) return;
    event.preventDefault();
    const current = tabs.findIndex((tab) => tab.active);
    const next = tabs[(current + step + tabs.length) % tabs.length]!;
    sendBrowserCommand(chatId, { command: 'select', tabId: next.id });
    document.getElementById(`bp-tab-${next.id}`)?.focus();
  };
  return (
    <div className="bp-tabs">
      <div className="bp-tablist" role="group" aria-label="Browser tabs" onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <div key={tab.id} className={tab.active ? 'bp-tab on' : 'bp-tab'}>
            <button
              type="button"
              id={`bp-tab-${tab.id}`}
              className="bp-tab-main"
              aria-current={tab.active ? 'page' : undefined}
              aria-controls="bp-view"
              title={tab.url}
              onClick={() => sendBrowserCommand(chatId, { command: 'select', tabId: tab.id })}
            >
              {tab.owner === 'agent' && <span className="bp-agent">Agent</span>}
              <span className="bp-tab-title">{tabLabel(tab)}</span>
            </button>
            {tab.owner === 'agent' && (
              <button
                type="button"
                className="bp-tab-x"
                aria-label={tab.pinned ? `Unpin ${tabLabel(tab)}` : `Keep ${tabLabel(tab)} open`}
                aria-pressed={tab.pinned}
                title={tab.pinned ? 'Pinned: stays open' : 'Keep this tab after the turn ends'}
                onClick={() =>
                  sendBrowserCommand(chatId, {
                    command: 'pin',
                    tabId: tab.id,
                    pinned: !tab.pinned,
                  })
                }
              >
                {tab.pinned ? <UnpinIcon /> : <PinIcon />}
              </button>
            )}
            <button
              type="button"
              className="bp-tab-x"
              aria-label={`Close ${tabLabel(tab)}`}
              onClick={() => sendBrowserCommand(chatId, { command: 'close', tabId: tab.id })}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="icon-btn bp-new"
        aria-label="New tab"
        onClick={() => sendBrowserCommand(chatId, { command: 'new_tab', url: null })}
      >
        <PlusIcon />
      </button>
    </div>
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

function StartPage({ tab }: { tab: BrowserPaneTab | null }) {
  if (tab?.error) {
    return (
      <div className="bp-start" role="status">
        <b>This page didn’t load</b>
        <p>{tab.error}</p>
        <p>If it is your dev server, start it in the terminal, then reload.</p>
      </div>
    );
  }
  return (
    <div className="bp-start">
      <b>Browser</b>
      <p>
        Type an address above to open a page. Your dev server works: try localhost and its port.
      </p>
      <p>
        Agents can open and read local pages here when you ask. Anything a page says is treated as
        untrusted.
      </p>
    </div>
  );
}

export function BrowserPane({ home, shown }: BrowserPaneProps) {
  const { chatId } = home;
  const browser = useChatBrowser(chatId);
  const view = useRef<HTMLDivElement>(null);
  const tab = activeTab(browser);
  const started = useRef(false);
  useViewPlacement(view, home, shown);

  useEffect(() => {
    if (!shown || started.current) return;
    started.current = true;
    void desktopBrowser()
      ?.start({
        chatId,
        projectId: home.projectId,
        keepSignIns: home.keepSignIns,
        roots: [...home.roots].slice(0, 16),
        bounds: null,
        covered: false,
      })
      .then(acceptBrowserState);
  }, [shown, chatId, home.projectId, home.keepSignIns, home.roots]);

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

  return (
    <section className="bp" aria-label="Browser">
      <TabStrip chatId={chatId} tabs={browser.tabs} />
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
        <AddressBar key={`${tab?.id ?? ''}:${tab?.url ?? ''}`} chatId={chatId} tab={tab} />
        <ToolButton
          label={tab?.picking ? 'Stop selecting' : 'Select an element for the chat'}
          disabled={blank}
          pressed={tab?.picking ?? false}
          onClick={() => pick('element')}
        >
          <PickElementIcon />
        </ToolButton>
        <ToolButton
          label="Select a region for the chat"
          disabled={blank || (tab?.picking ?? false)}
          onClick={() => pick('region')}
        >
          <PickRegionIcon />
        </ToolButton>
      </div>
      <div className="bp-status" aria-live="polite">
        {tab?.loading && (
          <span className="bp-loading" role="status" aria-label="Page is opening">
            <SpinnerIcon />
          </span>
        )}
        {tab && <span className="bp-title">{tab.title}</span>}
        {tab?.picking && (
          <span className="bp-badge">Click an element or drag a box. Esc cancels.</span>
        )}
        {tab?.driving && <span className="bp-badge drive">Spark is driving</span>}
      </div>
      <div className="bp-view" id="bp-view" ref={view}>
        {blank && <StartPage tab={tab} />}
        {!blank && browser.snapshot && (
          <img className="bp-snapshot" src={browser.snapshot} alt="" />
        )}
      </div>
    </section>
  );
}
