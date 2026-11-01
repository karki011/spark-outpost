import { sameFavoritePage, type BrowserFavorite } from '@spark-outpost/contracts';

export interface ArchiveFacts {
  id: string;
  url: string;
  pinned: boolean;
  spaceId: string;
  shownAt: number;
  audible: boolean;
  busy: boolean;
  showing: boolean;
}

function frontOfEachSpace(tabs: readonly ArchiveFacts[]): Set<string> {
  const front = new Map<string, ArchiveFacts>();
  for (const tab of tabs) {
    const best = front.get(tab.spaceId);
    if (!best || (!best.showing && (tab.showing || tab.shownAt >= best.shownAt))) {
      front.set(tab.spaceId, tab);
    }
  }
  return new Set([...front.values()].map((tab) => tab.id));
}

export function tabsToArchive(
  tabs: readonly ArchiveFacts[],
  favorites: readonly BrowserFavorite[],
  afterMs: number,
  now: number,
): string[] {
  const front = frontOfEachSpace(tabs);
  const kept = (tab: ArchiveFacts) =>
    tab.pinned ||
    tab.audible ||
    tab.busy ||
    tab.showing ||
    front.has(tab.id) ||
    favorites.some((favorite) => sameFavoritePage(favorite.url, tab.url));
  return tabs.filter((tab) => !kept(tab) && now - tab.shownAt >= afterMs).map((tab) => tab.id);
}
