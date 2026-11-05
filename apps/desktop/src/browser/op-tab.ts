import { browserPlaceOf, type BrowserHostErrorCode } from '@spark-outpost/contracts';
import type { BrowserPanes } from './panes.ts';
import type { PaneTab } from './tab.ts';

export class BrowserOpError extends Error {
  readonly code: BrowserHostErrorCode;

  constructor(code: BrowserHostErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function tabFacts(tab: PaneTab) {
  const url = tab.currentUrl();
  return {
    tabId: tab.id,
    url: url.slice(0, 4096),
    title: tab.currentTitle().slice(0, 300),
    place: browserPlaceOf(url),
    owner: tab.owner,
  };
}

export function targetTab(
  panes: BrowserPanes,
  chatId: string,
  wanted: string | undefined,
): PaneTab {
  const tabs = panes.tabsOf(chatId);
  const tab = wanted
    ? tabs.find((candidate) => candidate.id === wanted)
    : (tabs
        .filter((candidate) => candidate.owner === 'agent')
        .sort((a, b) => b.lastUsed - a.lastUsed)[0] ?? tabs.find((candidate) => candidate.active));
  if (!tab) {
    throw new BrowserOpError(
      'no_tab',
      wanted ? `There is no tab ${wanted} in this chat.` : 'No tab is open in this chat yet.',
    );
  }
  refuseHeld(tab);
  return tab;
}

const SIGNING_IN =
  'The user is signing in on this tab. Wait for spark_browser_sign_in to return, then go on.';

export function refuseHeld(tab: PaneTab): void {
  if (tab.picking) {
    throw new BrowserOpError('user_picking', 'The user is selecting on this tab. Try again soon.');
  }
  if (tab.handoff) throw new BrowserOpError('user_signing_in', SIGNING_IN);
}
