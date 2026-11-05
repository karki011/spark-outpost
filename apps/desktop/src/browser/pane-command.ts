import { clipboard } from 'electron';
import {
  addressToUrl,
  type BrowserClosedTab,
  type BrowserCommand,
  type BrowserPipResult,
} from '@spark-outpost/contracts';
import type { BrowserPanes } from './panes.ts';
import { isTabBasic, runTabBasic } from './tab-basics.ts';
import type { PaneTab } from './tab.ts';

export interface PaneCommandHooks {
  tabsMax: number;
  pick?(tab: PaneTab, mode: 'element' | 'region' | 'off'): Promise<void>;
  closed?(tab: PaneTab): void;
}

async function navigate(panes: BrowserPanes, key: string, tab: PaneTab, typed: string) {
  const url = addressToUrl(typed);
  if (!url) return;
  if (!tab.handoff) {
    tab.owner = 'user';
    tab.runId = null;
  }
  tab.lastAction = null;
  await tab.load(url);
  panes.noteChange(key);
  panes.layout();
}

export async function runPaneCommand(
  panes: BrowserPanes,
  key: string,
  action: BrowserCommand,
  hooks: PaneCommandHooks,
): Promise<BrowserClosedTab | BrowserPipResult | undefined> {
  if (action.command === 'new_tab') {
    const url = action.url ? addressToUrl(action.url) : null;
    const tab = panes.createTab(key, { owner: 'user', runId: null, url: 'about:blank' });
    if (!tab) return;
    panes.select(key, tab.id);
    if (url) await navigate(panes, key, tab, url);
    return;
  }
  if (action.command === 'reopen') {
    if (panes.tabsOf(key).length >= hooks.tabsMax) return;
    const url = panes.takeClosed(key);
    if (url) await runPaneCommand(panes, key, { command: 'new_tab', url }, hooks);
    return;
  }
  const tab = panes.tab(key, action.tabId);
  if (!tab) {
    panes.resync(key);
    return;
  }
  if (isTabBasic(action)) return runTabBasic(panes, key, tab, action);
  if (action.command === 'navigate') await navigate(panes, key, tab, action.url);
  else if (action.command === 'select') panes.keepFocus(key, () => panes.select(key, tab.id));
  else if (action.command === 'close') {
    let closed: BrowserClosedTab = { handoff: null };
    panes.keepFocus(key, () => {
      closed = panes.closeByUser(key, tab.id);
    });
    hooks.closed?.(tab);
    return closed;
  } else if (action.command === 'copy_url') {
    const url = tab.currentUrl();
    if (url !== 'about:blank') clipboard.writeText(url);
  } else if (action.command === 'find') {
    await tab.wake();
    tab.find(action.text, action.forward, action.next);
  } else if (action.command === 'stop_find') {
    tab.stopFind();
  } else if (action.command === 'focus') {
    tab.contents()?.focus();
  } else if (action.command === 'pin') {
    tab.pinned = action.pinned;
    panes.noteChange(key);
  } else if (action.command === 'devtools') {
    tab.openDevtools();
  } else if (action.command === 'pick') {
    if (!hooks.pick) return;
    tab.keep();
    await hooks.pick(tab, action.mode);
  } else {
    tab.keep();
    tab.history(action.command);
  }
}
