import {
  SEARCH_ENGINES,
  addressToUrl,
  historyUrl,
  searchUrl,
  type BrowserArchivedTab,
  type BrowserFavorite,
  type BrowserHistoryEntry,
  type BrowserPaneTab,
  type BrowserSearchEngine,
} from '@spark-outpost/contracts';
import { tabLabel } from '../browser/tab-label.ts';

export type BarMode = 'new' | 'here';
export type BarAction = 'ask_spark' | 'new_chat' | 'copy_link' | 'default_browser';
export type BarGroup =
  'address' | 'tabs' | 'favorites' | 'history' | 'archived' | 'actions' | 'search';

export type BarTarget =
  | { kind: 'tab'; tabId: string; url: string }
  | { kind: 'open'; url: string }
  | { kind: 'archived'; id: string }
  | { kind: 'action'; action: BarAction };

export interface BarRow {
  key: string;
  group: BarGroup;
  title: string;
  detail: string;
  target: BarTarget;
}

export interface BarInput {
  text: string;
  tabs: readonly BrowserPaneTab[];
  favorites: readonly BrowserFavorite[];
  history: readonly BrowserHistoryEntry[];
  archived?: readonly BrowserArchivedTab[];
  page: boolean;
  search: BrowserSearchEngine | null;
}

export const GROUP_TITLES: Record<BarGroup, string> = {
  address: 'Go to',
  tabs: 'Open tabs',
  favorites: 'Favorites',
  history: 'History',
  archived: 'Archived',
  search: 'Search the web',
  actions: 'Actions',
};

const ACTIONS: { action: BarAction; title: string; page: boolean }[] = [
  { action: 'ask_spark', title: 'Ask Spark about this page', page: false },
  { action: 'new_chat', title: 'New chat about this page', page: false },
  { action: 'copy_link', title: 'Copy link', page: true },
  { action: 'default_browser', title: 'Open in default browser', page: true },
];

const PER_GROUP = 6;

function host(url: string): string {
  return URL.canParse(url) ? new URL(url).host : url;
}

function matches(wanted: string, ...fields: string[]): boolean {
  return wanted === '' || fields.some((field) => field.toLowerCase().includes(wanted));
}

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function barRows(input: BarInput, now = Date.now()): BarRow[] {
  const wanted = input.text.trim().toLowerCase();
  const address = addressToUrl(input.text);
  const rows: BarRow[] = [];
  if (address && /^https?:/.test(address)) {
    rows.push({
      key: `address:${address}`,
      group: 'address',
      title: address,
      detail: 'Web address',
      target: { kind: 'open', url: address },
    });
  }
  const tabs = input.tabs.filter(
    (tab) => tab.url !== '' && matches(wanted, tabLabel(tab), tab.url),
  );
  for (const tab of tabs.slice(0, PER_GROUP)) {
    rows.push({
      key: `tab:${tab.id}`,
      group: 'tabs',
      title: tabLabel(tab),
      detail: tab.active ? 'Showing' : tab.pinned ? `Pinned · ${host(tab.url)}` : host(tab.url),
      target: { kind: 'tab', tabId: tab.id, url: tab.url },
    });
  }
  const open = new Set(input.tabs.flatMap((tab) => [tab.url, historyUrl(tab.url) ?? tab.url]));
  const favorites = input.favorites.filter(
    (favorite) => !open.has(favorite.url) && matches(wanted, favorite.title, favorite.url),
  );
  for (const favorite of favorites.slice(0, PER_GROUP)) {
    rows.push({
      key: `favorite:${favorite.url}`,
      group: 'favorites',
      title: favorite.title || host(favorite.url),
      detail: host(favorite.url),
      target: { kind: 'open', url: favorite.url },
    });
  }
  const seen = new Set([...open, ...favorites.map((favorite) => favorite.url)]);
  const history = input.history.filter(
    (entry) => !seen.has(entry.url) && matches(wanted, entry.title, entry.url),
  );
  for (const entry of history.slice(0, PER_GROUP)) {
    rows.push({
      key: `history:${entry.url}`,
      group: 'history',
      title: entry.title || host(entry.url),
      detail: `${host(entry.url)} · ${ago(entry.lastVisitedAt, now)}`,
      target: { kind: 'open', url: entry.url },
    });
  }
  const archived = (input.archived ?? []).filter((entry) =>
    matches(wanted, entry.title, entry.url),
  );
  for (const entry of archived.slice(0, PER_GROUP)) {
    rows.push({
      key: `archived:${entry.id}`,
      group: 'archived',
      title: entry.title || host(entry.url),
      detail: `${host(entry.url)} · archived ${ago(new Date(entry.archivedAt).toISOString(), now)}`,
      target: { kind: 'archived', id: entry.id },
    });
  }
  for (const item of ACTIONS) {
    if (item.page && !input.page) continue;
    if (!matches(wanted, item.title)) continue;
    rows.push({
      key: `action:${item.action}`,
      group: 'actions',
      title: item.title,
      detail: '',
      target: { kind: 'action', action: item.action },
    });
  }
  const query = input.text.trim();
  if (input.search && query !== '' && !/^https?:\/\//i.test(query)) {
    const engine = SEARCH_ENGINES[input.search].label;
    rows.push({
      key: `search:${input.search}`,
      group: 'search',
      title: `Search ${engine} for “${query}”`,
      detail: `Sends what you typed to ${engine}`,
      target: { kind: 'open', url: searchUrl(input.search, query) },
    });
  }
  return rows;
}

export function barSections(rows: readonly BarRow[]) {
  const groups: BarGroup[] = [
    'address',
    'tabs',
    'favorites',
    'history',
    'archived',
    'actions',
    'search',
  ];
  let index = 0;
  return groups
    .map((group) => ({
      group,
      rows: rows.filter((row) => row.group === group).map((row) => ({ row, index: index++ })),
    }))
    .filter((section) => section.rows.length > 0);
}
