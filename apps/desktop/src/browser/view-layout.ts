import { randomUUID } from 'node:crypto';
import {
  BROWSER_ARCHIVED_MAX,
  BROWSER_SPACES_MAX,
  BROWSER_TAB_FOLDERS_MAX,
  type BrowserArchivedTab,
  type BrowserProfile,
  type BrowserViewCommand,
  type BrowserViewLayout,
} from '@spark-outpost/contracts';
import type { SavedLayout, SavedProfile, SavedTab } from './view-saved.ts';

export interface TabMeta {
  spaceId: string;
  folderId: string | null;
  pinnedUrl: string | null;
  shownAt: number;
}

export interface ProfileLayout extends SavedLayout {
  profile: BrowserProfile;
  metas: Map<string, TabMeta>;
  lastActive: string | null;
}

type LayoutCommand = Extract<
  BrowserViewCommand,
  {
    command:
      | `space_${string}`
      | `folder_${string}`
      | 'tab_to_space'
      | 'tab_to_folder'
      | `archived_${'remove' | 'clear'}`;
  }
>;

export function layoutOf(profile: BrowserProfile, saved: SavedProfile): ProfileLayout {
  return {
    profile,
    spaces: saved.spaces,
    currentSpaceId: saved.currentSpaceId,
    folders: saved.folders,
    archived: saved.archived,
    metas: new Map(),
    lastActive: null,
  };
}

export function savedLayout(layout: ProfileLayout): SavedLayout {
  const { spaces, currentSpaceId, folders, archived } = layout;
  return { spaces, currentSpaceId, folders, archived };
}

export function layoutSnapshot(
  layout: ProfileLayout,
  tabIds: readonly string[],
): BrowserViewLayout {
  return {
    ...savedLayout(layout),
    places: tabIds.flatMap((tabId) => {
      const meta = layout.metas.get(tabId);
      if (!meta) return [];
      const { spaceId, folderId, pinnedUrl } = meta;
      return [{ tabId, spaceId, folderId, pinnedUrl }];
    }),
  };
}

export function metaFromSaved(layout: SavedLayout, tab: SavedTab, now: number): TabMeta {
  const spaceId = layout.spaces.some((space) => space.id === tab.spaceId)
    ? tab.spaceId!
    : layout.spaces[0]!.id;
  const folderKnown = layout.folders.some(
    (folder) => folder.id === tab.folderId && folder.spaceId === spaceId,
  );
  return {
    spaceId,
    folderId: tab.pinned && folderKnown ? tab.folderId! : null,
    pinnedUrl: tab.pinned ? (tab.pinnedUrl ?? tab.url) : null,
    shownAt: Math.min(tab.shownAt ?? now, now),
  };
}

export function addArchived(
  layout: ProfileLayout,
  tabs: readonly Omit<BrowserArchivedTab, 'id'>[],
): void {
  const added = tabs.map((tab) => ({ ...tab, id: randomUUID().slice(0, 8) }));
  layout.archived = [...added, ...layout.archived].slice(0, BROWSER_ARCHIVED_MAX);
}

function nextId(): string {
  return randomUUID().slice(0, 8);
}

function moveTabsOutOfFolder(layout: ProfileLayout, folderId: string): void {
  for (const meta of layout.metas.values()) {
    if (meta.folderId === folderId) meta.folderId = null;
  }
}

function deleteSpace(layout: ProfileLayout, id: string): void {
  const index = layout.spaces.findIndex((space) => space.id === id);
  if (index < 0 || layout.spaces.length === 1) return;
  const spaces = layout.spaces.filter((space) => space.id !== id);
  const heir = spaces[Math.max(0, index - 1)]!;
  for (const meta of layout.metas.values()) {
    if (meta.spaceId !== id) continue;
    meta.spaceId = heir.id;
    meta.folderId = null;
  }
  layout.spaces = spaces;
  layout.folders = layout.folders.filter((folder) => folder.spaceId !== id);
  if (layout.currentSpaceId === id) layout.currentSpaceId = heir.id;
}

function moveTabToSpace(layout: ProfileLayout, tabId: string, spaceId: string): void {
  const meta = layout.metas.get(tabId);
  if (!meta || !layout.spaces.some((space) => space.id === spaceId)) return;
  if (meta.spaceId === spaceId) return;
  meta.spaceId = spaceId;
  meta.folderId = null;
}

function createFolder(layout: ProfileLayout, name: string, tabId: string | null): void {
  if (layout.folders.length >= BROWSER_TAB_FOLDERS_MAX) return;
  const folder = { id: nextId(), spaceId: layout.currentSpaceId, name, collapsed: false };
  layout.folders = [...layout.folders, folder];
  const meta = tabId === null ? undefined : layout.metas.get(tabId);
  if (meta?.pinnedUrl && meta.spaceId === folder.spaceId) meta.folderId = folder.id;
}

function moveTabToFolder(layout: ProfileLayout, tabId: string, folderId: string | null): void {
  const meta = layout.metas.get(tabId);
  if (!meta || meta.pinnedUrl === null) return;
  if (folderId === null) {
    meta.folderId = null;
    return;
  }
  const folder = layout.folders.find((candidate) => candidate.id === folderId);
  if (folder?.spaceId === meta.spaceId) meta.folderId = folderId;
}

function patchFolder(
  layout: ProfileLayout,
  id: string,
  change: { name?: string; collapsed?: boolean },
): void {
  layout.folders = layout.folders.map((folder) =>
    folder.id === id ? { ...folder, ...change } : folder,
  );
}

export function isLayoutCommand(action: BrowserViewCommand): action is LayoutCommand {
  return /^(space_|folder_|tab_to_|archived_(remove|clear))/.test(action.command);
}

export function applyLayoutCommand(layout: ProfileLayout, action: LayoutCommand): void {
  switch (action.command) {
    case 'space_create': {
      if (layout.spaces.length >= BROWSER_SPACES_MAX) return;
      const { name, icon, color } = action;
      const space = { id: nextId(), name, icon, color };
      layout.spaces = [...layout.spaces, space];
      layout.currentSpaceId = space.id;
      return;
    }
    case 'space_update': {
      const { id, name, icon, color } = action;
      layout.spaces = layout.spaces.map((space) =>
        space.id === id ? { id, name, icon, color } : space,
      );
      return;
    }
    case 'space_delete':
      return deleteSpace(layout, action.id);
    case 'space_switch':
      if (layout.spaces.some((space) => space.id === action.id)) {
        layout.currentSpaceId = action.id;
      }
      return;
    case 'tab_to_space':
      return moveTabToSpace(layout, action.tabId, action.spaceId);
    case 'folder_create':
      return createFolder(layout, action.name, action.tabId);
    case 'folder_rename':
      return patchFolder(layout, action.id, { name: action.name });
    case 'folder_collapse':
      return patchFolder(layout, action.id, { collapsed: action.collapsed });
    case 'folder_delete':
      moveTabsOutOfFolder(layout, action.id);
      layout.folders = layout.folders.filter((folder) => folder.id !== action.id);
      return;
    case 'tab_to_folder':
      return moveTabToFolder(layout, action.tabId, action.folderId);
    case 'archived_remove':
      layout.archived = layout.archived.filter((tab) => tab.id !== action.id);
      return;
    case 'archived_clear':
      layout.archived = [];
      return;
  }
}
