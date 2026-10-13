import { useEffect, type KeyboardEvent } from 'react';
import type { BrowserPaneTab } from '@spark-outpost/contracts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { PinIcon, PlusIcon, SpinnerIcon, UnpinIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { sendBrowserCommand } from './browser-store.ts';
import { tabLabel } from './tab-label.ts';

interface BrowserTabsProps {
  chatId: string;
  tabs: readonly BrowserPaneTab[];
}

const tabElementId = (tab: BrowserPaneTab) => `bp-tab-${tab.id}`;

function nextIndex(key: string, current: number, count: number): number | null {
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

function PageTab({
  chatId,
  tab,
  focusable,
}: {
  chatId: string;
  tab: BrowserPaneTab;
  focusable: boolean;
}) {
  const label = tabLabel(tab);
  return (
    <div className={tab.active ? 'bp-tab on' : 'bp-tab'}>
      <button
        type="button"
        role="tab"
        id={tabElementId(tab)}
        className="bp-tab-main"
        aria-selected={tab.active}
        aria-controls="bp-view"
        tabIndex={focusable ? 0 : -1}
        title={tab.url || label}
        onClick={() => sendBrowserCommand(chatId, { command: 'select', tabId: tab.id })}
      >
        {tab.loading && (
          <span className="bp-loading" aria-hidden="true">
            <SpinnerIcon />
          </span>
        )}
        {tab.owner === 'agent' && (
          <span className={tab.driving ? 'bp-agent driving' : 'bp-agent'}>
            Agent{tab.driving && <span className="sr-only"> is working on this tab</span>}
          </span>
        )}
        <span className="bp-tab-title">{label}</span>
      </button>
      {tab.owner === 'agent' && (
        <button
          type="button"
          className="bp-tab-x"
          aria-label={tab.pinned ? `Unpin ${label}` : `Keep ${label} open`}
          aria-pressed={tab.pinned}
          title={tab.pinned ? 'Pinned: stays open' : 'Keep this tab after the turn ends'}
          onClick={() =>
            sendBrowserCommand(chatId, { command: 'pin', tabId: tab.id, pinned: !tab.pinned })
          }
        >
          {tab.pinned ? <UnpinIcon /> : <PinIcon />}
        </button>
      )}
      <button
        type="button"
        className="bp-tab-x"
        aria-label={`Close ${label}`}
        onClick={() => sendBrowserCommand(chatId, { command: 'close', tabId: tab.id })}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export function BrowserTabs({ chatId, tabs }: BrowserTabsProps) {
  const newTip = useTooltip('New tab', { side: 'bottom' });
  const active = tabs.find((tab) => tab.active) ?? null;
  const activeId = active?.id ?? null;
  const focusableId = activeId ?? tabs[0]?.id ?? null;

  useEffect(() => {
    if (!activeId) return;
    document
      .getElementById(`bp-tab-${activeId}`)
      ?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.role !== 'tab') return;
    const current = tabs.findIndex((tab) => tabElementId(tab) === (event.target as HTMLElement).id);
    const index = tabs.length > 0 ? nextIndex(event.key, current, tabs.length) : null;
    if (index === null) return;
    event.preventDefault();
    const next = tabs[index]!;
    sendBrowserCommand(chatId, { command: 'select', tabId: next.id });
    document.getElementById(tabElementId(next))?.focus();
  };

  return (
    <>
      <div className="bp-tabs" onKeyDown={onKeyDown}>
        <div
          role="tablist"
          aria-label="Browser tabs"
          aria-owns={tabs.map(tabElementId).join(' ') || undefined}
        />
        {tabs.map((tab) => (
          <PageTab key={tab.id} chatId={chatId} tab={tab} focusable={tab.id === focusableId} />
        ))}
      </div>
      <button
        type="button"
        className="icon-btn bp-new"
        aria-label="New tab"
        {...newTip.triggerProps}
        onClick={() => sendBrowserCommand(chatId, { command: 'new_tab', url: null })}
      >
        <PlusIcon />
      </button>
      {newTip.tooltip}
      <span className="sr-only" role="status">
        {active?.loading ? 'Page is opening' : ''}
      </span>
    </>
  );
}
