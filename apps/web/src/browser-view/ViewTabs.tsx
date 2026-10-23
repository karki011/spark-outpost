import type { KeyboardEvent } from 'react';
import type { BrowserPaneTab, BrowserProfile } from '@spark-outpost/contracts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { PlusIcon, SpinnerIcon } from '../ui/icons.tsx';
import { Keys } from '../ui/Keys.tsx';
import { PANE_KEYS } from '../browser/pane-shortcuts.ts';
import { tabLabel } from '../browser/tab-label.ts';
import { sendViewCommand } from './view-store.ts';

interface ViewTabsProps {
  profile: BrowserProfile;
  tabs: readonly BrowserPaneTab[];
}

const tabElementId = (tab: BrowserPaneTab) => `bv-tab-${tab.id}`;

function initial(tab: BrowserPaneTab): string {
  return (tabLabel(tab).trim()[0] ?? '?').toUpperCase();
}

function nextIndex(key: string, current: number, count: number): number | null {
  if (key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export function ViewTabs({ profile, tabs }: ViewTabsProps) {
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
    <section className="bv-section" aria-labelledby="bv-today">
      <h2 id="bv-today" className="bv-heading">
        Today
      </h2>
      <button
        type="button"
        className="bv-row bv-new"
        aria-keyshortcuts={PANE_KEYS.newTab.aria}
        onClick={() => sendViewCommand(profile, { command: 'new_tab', url: null })}
      >
        <PlusIcon />
        <span>New tab</span>
        <Keys keys={PANE_KEYS.newTab.shown} />
      </button>
      <ul className="bv-tabs" aria-label="Tabs" onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const label = tabLabel(tab);
          return (
            <li key={tab.id} className={tab.active ? 'bv-tab on' : 'bv-tab'}>
              <button
                type="button"
                id={tabElementId(tab)}
                className="bv-row bv-tab-main"
                aria-current={tab.active ? 'page' : undefined}
                aria-label={label}
                tabIndex={tab.id === focusableId ? 0 : -1}
                title={tab.url || label}
                onClick={() => select(tab)}
              >
                <span className="bv-tile" aria-hidden="true">
                  {tab.loading ? <SpinnerIcon /> : initial(tab)}
                </span>
                <span className="bv-tab-title">{label}</span>
              </button>
              <button
                type="button"
                className="icon-btn bv-tab-x"
                aria-label={`Close ${label}`}
                aria-keyshortcuts={tab.active ? PANE_KEYS.close.aria : undefined}
                onClick={() => sendViewCommand(profile, { command: 'close', tabId: tab.id })}
              >
                <CloseIcon />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
