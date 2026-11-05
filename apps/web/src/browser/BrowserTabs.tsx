import { useEffect, type KeyboardEvent } from 'react';
import type { BrowserPaneTab } from '@spark-outpost/contracts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { PinIcon, PlusIcon, SpinnerIcon, UnpinIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { closeBrowserTab, sendBrowserCommand } from './browser-store.ts';
import { PANE_KEYS } from './pane-shortcuts.ts';
import { TabAudio } from './TabAudio.tsx';
import { tabLabel } from './tab-label.ts';
import { useTabOrder } from './use-tab-order.ts';

interface BrowserTabsProps {
  chatId: string;
  tabs: readonly BrowserPaneTab[];
}

const elementId = (id: string) => `bp-tab-${id}`;
const tabElementId = (tab: BrowserPaneTab) => elementId(tab.id);

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
  order,
}: {
  chatId: string;
  tab: BrowserPaneTab;
  focusable: boolean;
  order: ReturnType<typeof useTabOrder>;
}) {
  const label = tabLabel(tab);
  return (
    <div
      className={`${tab.active ? 'bp-tab on' : 'bp-tab'} ${order.dropClass(tab.id)}`}
      data-tab-item={tab.id}
    >
      <button
        type="button"
        role="tab"
        id={tabElementId(tab)}
        className="bp-tab-main"
        aria-selected={tab.active}
        aria-controls="bp-view"
        tabIndex={focusable ? 0 : -1}
        title={tab.url || label}
        aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight"
        {...order.handlers(tab.id)}
        onClick={() => sendBrowserCommand(chatId, { command: 'select', tabId: tab.id })}
      >
        {tab.loading && (
          <span className="bp-loading" aria-hidden="true">
            <SpinnerIcon />
          </span>
        )}
        {tab.owner === 'agent' && (
          <span className={tab.driving ? 'bp-agent driving' : 'bp-agent'}>Agent</span>
        )}
        <span className="bp-tab-title">{label}</span>
      </button>
      <TabAudio
        tab={tab}
        label={label}
        onMute={(muted) => sendBrowserCommand(chatId, { command: 'mute', tabId: tab.id, muted })}
      />
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
        aria-keyshortcuts={tab.active ? PANE_KEYS.close.aria : undefined}
        onClick={() => void closeBrowserTab(chatId, tab.id)}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export function BrowserTabs({ chatId, tabs }: BrowserTabsProps) {
  const newTip = useTooltip('New tab', { side: 'bottom', keys: PANE_KEYS.newTab.shown });
  const active = tabs.find((tab) => tab.active) ?? null;
  const activeId = active?.id ?? null;
  const focusableId = activeId ?? tabs[0]?.id ?? null;

  useEffect(() => {
    if (!activeId) return;
    document
      .getElementById(`bp-tab-${activeId}`)
      ?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  const order = useTabOrder({
    ids: tabs.map((tab) => tab.id),
    axis: 'x',
    elementId,
    labelOf: (id) => tabLabel(tabs.find((tab) => tab.id === id)!),
    move: (tabId, before) => sendBrowserCommand(chatId, { command: 'move', tabId, before }),
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.role !== 'tab') return;
    const current = tabs.findIndex((tab) => tabElementId(tab) === (event.target as HTMLElement).id);
    if (tabs[current] && order.keyMove(event, tabs[current].id)) return;
    const index = tabs.length > 0 ? nextIndex(event.key, current, tabs.length) : null;
    if (index === null) return;
    event.preventDefault();
    const next = tabs[index]!;
    sendBrowserCommand(chatId, { command: 'select', tabId: next.id });
    document.getElementById(tabElementId(next))?.focus();
  };

  return (
    <>
      <div className="bp-tabs" data-tab-list="" onKeyDown={onKeyDown}>
        <div
          role="tablist"
          aria-label="Browser tabs"
          aria-owns={tabs.map(tabElementId).join(' ') || undefined}
        />
        {tabs.map((tab) => (
          <PageTab
            key={tab.id}
            chatId={chatId}
            tab={tab}
            focusable={tab.id === focusableId}
            order={order}
          />
        ))}
      </div>
      <button
        type="button"
        className="icon-btn bp-new"
        aria-label="New tab"
        aria-keyshortcuts={PANE_KEYS.newTab.aria}
        {...newTip.triggerProps}
        onClick={() => sendBrowserCommand(chatId, { command: 'new_tab', url: null })}
      >
        <PlusIcon />
      </button>
      {newTip.tooltip}
      <span className="sr-only" role="status">
        {active?.loading ? 'Page is opening' : order.moved}
      </span>
    </>
  );
}
