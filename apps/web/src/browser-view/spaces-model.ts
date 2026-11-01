import {
  browserSpaceKey,
  type BrowserPaneTab,
  type BrowserTabPlace,
  type BrowserViewLayout,
} from '@spark-outpost/contracts';

export function placeOf(layout: BrowserViewLayout, tabId: string): BrowserTabPlace | null {
  return layout.places.find((place) => place.tabId === tabId) ?? null;
}

export function tabsInCurrentSpace(
  tabs: readonly BrowserPaneTab[],
  layout: BrowserViewLayout,
): BrowserPaneTab[] {
  return tabs.filter((tab) => {
    const place = placeOf(layout, tab.id);
    return !place || place.spaceId === layout.currentSpaceId;
  });
}

export function pinnedGroups(tabs: readonly BrowserPaneTab[], layout: BrowserViewLayout) {
  const pinned = tabs.filter((tab) => tab.pinned);
  const folders = layout.folders.filter((folder) => folder.spaceId === layout.currentSpaceId);
  const known = new Set(folders.map((folder) => folder.id));
  const folderOf = (tab: BrowserPaneTab) => placeOf(layout, tab.id)?.folderId ?? null;
  return {
    loose: pinned.filter((tab) => {
      const folderId = folderOf(tab);
      return folderId === null || !known.has(folderId);
    }),
    folders: folders.map((folder) => ({
      folder,
      tabs: pinned.filter((tab) => folderOf(tab) === folder.id),
    })),
  };
}

interface KeyLike {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  keyCode: number;
  nativeEvent: { isComposing: boolean };
}

export function chromeSpaceIndex(event: KeyLike, mac: boolean): number | null {
  return browserSpaceKey(
    {
      code: event.code,
      meta: event.metaKey,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      composing: event.nativeEvent.isComposing || event.keyCode === 229,
    },
    mac,
  );
}
