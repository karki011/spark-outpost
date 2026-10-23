import {
  BROWSER_HISTORY_TITLE_MAX,
  browserProfileSchema,
  historyUrl,
  type BrowserHistoryEvent,
} from '@spark-outpost/contracts';
import type { PaneTab } from './tab.ts';

export type HistorySink = (event: BrowserHistoryEvent) => void;

type HistoryTab = Pick<PaneTab, 'chatId' | 'currentUrl'>;

function event(
  kind: BrowserHistoryEvent['kind'],
  tab: HistoryTab,
  url: string,
  title: string,
): BrowserHistoryEvent | null {
  const profile = browserProfileSchema.safeParse(tab.chatId);
  const kept = historyUrl(url);
  if (!profile.success || kept === null) return null;
  return {
    kind,
    profile: profile.data,
    url: kept,
    title: title.slice(0, BROWSER_HISTORY_TITLE_MAX),
  };
}

export function viewHistory(sink: HistorySink | undefined) {
  const send = (next: BrowserHistoryEvent | null) => {
    if (next && sink) sink(next);
  };
  return {
    visited: (tab: HistoryTab, url: string, title: string) => send(event('visit', tab, url, title)),
    titled: (tab: HistoryTab, title: string) => send(event('title', tab, tab.currentUrl(), title)),
  };
}
