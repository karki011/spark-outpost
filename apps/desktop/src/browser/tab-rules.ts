import {
  BROWSER_AGENT_TABS_MAX,
  BROWSER_TABS_MAX,
  browserOrigin,
  originAndPath,
  type BrowserTabOwner,
} from '@spark-outpost/contracts';

export interface TabFacts {
  id: string;
  url: string;
  owner: BrowserTabOwner;
  active: boolean;
  pinned: boolean;
  failed: boolean;
  lastUsed: number;
}

export type OpenChoice =
  | { action: 'reuse'; tabId: string }
  | { action: 'reload'; tabId: string }
  | { action: 'navigate'; tabId: string }
  | { action: 'new' }
  | { action: 'limit' };

function agentTabs(tabs: readonly TabFacts[]): TabFacts[] {
  return tabs.filter((tab) => tab.owner === 'agent');
}

function oldest(tabs: readonly TabFacts[]): TabFacts | null {
  return tabs.reduce<TabFacts | null>(
    (found, tab) => (found === null || tab.lastUsed < found.lastUsed ? tab : found),
    null,
  );
}

function roomForNew(tabs: readonly TabFacts[]): OpenChoice {
  const mine = agentTabs(tabs);
  if (mine.length < BROWSER_AGENT_TABS_MAX && tabs.length < BROWSER_TABS_MAX) {
    return { action: 'new' };
  }
  const recyclable = oldest(mine.filter((tab) => !tab.pinned));
  return recyclable ? { action: 'navigate', tabId: recyclable.id } : { action: 'limit' };
}

function wantedTab(tabs: readonly TabFacts[], url: string, wanted: string): OpenChoice | null {
  const tab = tabs.find((candidate) => candidate.id === wanted);
  if (!tab) return null;
  if (tab.owner === 'agent') {
    return { action: tab.url === url ? 'reload' : 'navigate', tabId: tab.id };
  }
  return tab.url === url && !tab.failed ? { action: 'reuse', tabId: tab.id } : null;
}

export function chooseOpenTab(tabs: readonly TabFacts[], url: string, wanted?: string): OpenChoice {
  const asked = wanted ? wantedTab(tabs, url, wanted) : null;
  if (asked) return asked;
  const page = originAndPath(url);
  const mine = agentTabs(tabs);
  const samePage = mine.find((tab) => originAndPath(tab.url) === page);
  if (samePage) {
    return { action: samePage.url === url ? 'reload' : 'navigate', tabId: samePage.id };
  }
  const idleUserTab = tabs.find(
    (tab) => tab.owner === 'user' && !tab.active && !tab.failed && tab.url === url,
  );
  if (idleUserTab) return { action: 'reuse', tabId: idleUserTab.id };
  const origin = browserOrigin(url);
  const sameOrigin = mine.find((tab) => !tab.pinned && browserOrigin(tab.url) === origin);
  if (sameOrigin) return { action: 'navigate', tabId: sameOrigin.id };
  return roomForNew(tabs);
}
