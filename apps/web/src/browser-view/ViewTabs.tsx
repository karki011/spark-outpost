import type { KeyboardEvent } from 'react';
import {
  splitHolds,
  type BrowserPaneTab,
  type BrowserProfile,
  type BrowserViewSplit,
} from '@spark-outpost/contracts';
import { SplitViewIcon } from '../browser/BrowserIcons.tsx';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { PinIcon, PlusIcon, SpinnerIcon, UnpinIcon } from '../ui/icons.tsx';
import { Keys } from '../ui/Keys.tsx';
import { PANE_KEYS } from '../browser/pane-shortcuts.ts';
import { tabLabel } from '../browser/tab-label.ts';
import { sendViewCommand } from './view-store.ts';

interface ViewTabsProps {
  profile: BrowserProfile;
  tabs: readonly BrowserPaneTab[];
  split: BrowserViewSplit | null;
  onNewTab(): void;
}

const tabElementId = (tab: BrowserPaneTab) => `bv-tab-${tab.id}`;

export function initialOf(label: string): string {
  return (label.trim()[0] ?? '?').toUpperCase();
}

function nextIndex(key: string, current: number, count: number): number | null {
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

function TabList({
  profile,
  tabs,
  split,
  label,
}: Omit<ViewTabsProps, 'onNewTab'> & { label: string }) {
  const focusableId = tabs.find((tab) => tab.active)?.id ?? tabs[0]?.id ?? null;
  const select = (tab: BrowserPaneTab) =>
    sendViewCommand(profile, { command: 'select', tabId: tab.id });

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches('.bv-tab-main')) return;
    const current = tabs.findIndex((tab) => tabElementId(tab) === (event.target as HTMLElement).id);
    const index = tabs.length > 0 ? nextIndex(event.key, current, tabs.length) : null;
    if (index === null) return;
    event.preventDefault();
    const next = tabs[index]!;
    select(next);
    document.getElementById(tabElementId(next))?.focus();
  };

  return (
    <ul className="bv-tabs" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const title = tabLabel(tab);
        return (
          <li key={tab.id} className={tab.active ? 'bv-tab on' : 'bv-tab'}>
            <button
              type="button"
              id={tabElementId(tab)}
              className="bv-row bv-tab-main"
              aria-current={tab.active ? 'page' : undefined}
              aria-label={title}
              tabIndex={tab.id === focusableId ? 0 : -1}
              title={tab.url || title}
              onClick={() => select(tab)}
            >
              <span className="bv-tile" aria-hidden="true">
                {tab.loading ? <SpinnerIcon /> : initialOf(title)}
              </span>
              <span className="bv-tab-title">{title}</span>
              {splitHolds(split, tab.id) && (
                <span className="bv-tab-split">
                  <SplitViewIcon />
                  Split
                </span>
              )}
            </button>
            <button
              type="button"
              className="icon-btn bv-tab-x"
              aria-label={tab.pinned ? `Unpin ${title}` : `Pin ${title}`}
              aria-pressed={tab.pinned}
              onClick={() =>
                sendViewCommand(profile, { command: 'pin', tabId: tab.id, pinned: !tab.pinned })
              }
            >
              {tab.pinned ? <UnpinIcon /> : <PinIcon />}
            </button>
            <button
              type="button"
              className="icon-btn bv-tab-x"
              aria-label={`Close ${title}`}
              aria-keyshortcuts={tab.active ? PANE_KEYS.close.aria : undefined}
              onClick={() => sendViewCommand(profile, { command: 'close', tabId: tab.id })}
            >
              <CloseIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ViewTabs({ profile, tabs, split, onNewTab }: ViewTabsProps) {
  const pinned = tabs.filter((tab) => tab.pinned);
  const today = tabs.filter((tab) => !tab.pinned);
  return (
    <>
      {pinned.length > 0 && (
        <section className="bv-section" aria-labelledby="bv-pinned">
          <h2 id="bv-pinned" className="bv-heading">
            Pinned
          </h2>
          <TabList profile={profile} tabs={pinned} split={split} label="Pinned tabs" />
        </section>
      )}
      <section className="bv-section" aria-labelledby="bv-today">
        <h2 id="bv-today" className="bv-heading">
          Today
        </h2>
        <button
          type="button"
          className="bv-row bv-new"
          aria-keyshortcuts={PANE_KEYS.newTab.aria}
          onClick={onNewTab}
        >
          <PlusIcon />
          <span>New tab</span>
          <Keys keys={PANE_KEYS.newTab.shown} />
        </button>
        <TabList profile={profile} tabs={today} split={split} label="Tabs" />
      </section>
    </>
  );
}
