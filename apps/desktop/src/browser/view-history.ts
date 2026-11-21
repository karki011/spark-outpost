import {
  BROWSER_HISTORY_TITLE_MAX,
  browserProfileSchema,
  historyUrl,
  type BrowserHistoryEvent,
  type BrowserProfile,
} from '@spark-outpost/contracts';
import type { PaneTab } from './tab.ts';

export type HistorySink = (event: BrowserHistoryEvent) => void;

type HistoryTab = Pick<PaneTab, 'chatId' | 'currentUrl'>;
type OwnedTab = Pick<PaneTab, 'owner' | 'currentUrl'>;

function event(
  kind: BrowserHistoryEvent['kind'],
  profile: BrowserProfile | null,
  url: string,
  title: string,
): BrowserHistoryEvent | null {
  const kept = historyUrl(url);
  if (profile === null || kept === null) return null;
  return { kind, profile, url: kept, title: title.slice(0, BROWSER_HISTORY_TITLE_MAX) };
}

function recorder(sink: HistorySink | undefined) {
  return (next: BrowserHistoryEvent | null) => {
    if (next && sink) sink(next);
  };
}

export function viewHistory(sink: HistorySink | undefined) {
  const send = recorder(sink);
  const profileOf = (tab: HistoryTab) => browserProfileSchema.safeParse(tab.chatId).data ?? null;
  return {
    visited: (tab: HistoryTab, url: string, title: string) =>
      send(event('visit', profileOf(tab), url, title)),
    titled: (tab: HistoryTab, title: string) =>
      send(event('title', profileOf(tab), tab.currentUrl(), title)),
  };
}

export function paneHistory(sink: HistorySink | undefined) {
  const send = recorder(sink);
  const profileOf = (tab: OwnedTab) => (tab.owner === 'user' ? 'work' : null);
  return {
    visited: (tab: OwnedTab, url: string) => send(event('visit', profileOf(tab), url, '')),
    titled: (tab: OwnedTab, title: string) =>
      send(event('title', profileOf(tab), tab.currentUrl(), title)),
  };
}
