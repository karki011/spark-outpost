import { classifyBrowserUrl, type BrowserProfile } from '@spark-outpost/contracts';
import type { BrowserPanes } from './panes.ts';
import type { PaneTab } from './tab.ts';
import { tabsToArchive, type ArchiveFacts } from './view-archive.ts';
import {
  addArchived,
  layoutOf,
  layoutSnapshot,
  metaFromSaved,
  savedLayout,
  type ProfileLayout,
  type TabMeta,
} from './view-layout.ts';
import type { SavedTab, SavedViewStore } from './view-saved.ts';

const BLANK = 'about:blank';
const MINUTE_MS = 60_000;

function webPage(url: string): boolean {
  const kind = classifyBrowserUrl(url);
  return kind === 'local' || kind === 'external';
}

function archivedEntry(url: string, title: string, now: number) {
  return { url, title: title.slice(0, 300), archivedAt: now };
}

export class ViewSpaces {
  private readonly layouts = new Map<BrowserProfile, ProfileLayout>();

  constructor(
    private readonly panes: () => BrowserPanes,
    private readonly saved: SavedViewStore,
    private readonly now: () => number,
  ) {}

  layout(profile: BrowserProfile): ProfileLayout {
    let layout = this.layouts.get(profile);
    if (!layout) {
      layout = layoutOf(profile, this.saved.get(profile));
      this.layouts.set(profile, layout);
    }
    return layout;
  }

  snapshot(profile: BrowserProfile) {
    const ids = this.panes()
      .tabsOf(profile)
      .filter((tab) => !tab.peek)
      .map((tab) => tab.id);
    return layoutSnapshot(this.layout(profile), ids);
  }

  private meta(layout: ProfileLayout, tab: PaneTab): TabMeta {
    let meta = layout.metas.get(tab.id);
    if (!meta) {
      meta = {
        spaceId: layout.currentSpaceId,
        folderId: null,
        pinnedUrl: null,
        shownAt: this.now(),
      };
      layout.metas.set(tab.id, meta);
    }
    return meta;
  }

  restoredTabs(profile: BrowserProfile): SavedTab[] {
    const layout = this.layout(profile);
    const tabs = this.saved.get(profile).tabs;
    const now = this.now();
    const setting = this.saved.archive();
    if (!setting.on) return [...tabs];
    const facts = tabs.map((tab, index): ArchiveFacts => {
      const meta = metaFromSaved(layout, tab, now);
      return {
        id: String(index),
        url: tab.url,
        pinned: tab.pinned,
        spaceId: meta.spaceId,
        shownAt: meta.shownAt,
        audible: false,
        busy: false,
        showing: tab.active,
      };
    });
    const due = new Set(
      tabsToArchive(
        facts,
        this.saved.get(profile).favorites,
        setting.afterMinutes * MINUTE_MS,
        now,
      ),
    );
    addArchived(
      layout,
      tabs
        .filter((_tab, index) => due.has(String(index)))
        .map((tab) => archivedEntry(tab.url, tab.title, now)),
    );
    return tabs.filter((_tab, index) => !due.has(String(index)));
  }

  adopt(profile: BrowserProfile, tab: PaneTab, saved: SavedTab): void {
    const layout = this.layout(profile);
    layout.metas.set(tab.id, metaFromSaved(layout, saved, this.now()));
  }

  savedTab(profile: BrowserProfile, tab: PaneTab): SavedTab {
    const meta = this.meta(this.layout(profile), tab);
    return {
      url: tab.currentUrl(),
      title: tab.currentTitle(),
      pinned: tab.pinned,
      active: tab.active,
      spaceId: meta.spaceId,
      folderId: meta.folderId,
      pinnedUrl: meta.pinnedUrl,
      shownAt: meta.shownAt,
    };
  }

  persist(profile: BrowserProfile): void {
    this.saved.setLayout(profile, savedLayout(this.layout(profile)));
  }

  private frontTab(layout: ProfileLayout, tabs: readonly PaneTab[]): PaneTab | null {
    let front: PaneTab | null = null;
    for (const tab of tabs) {
      const meta = this.meta(layout, tab);
      if (meta.spaceId !== layout.currentSpaceId) continue;
      if (!front || meta.shownAt >= this.meta(layout, front).shownAt) front = tab;
    }
    return front;
  }

  private settlePlaces(layout: ProfileLayout, tabs: readonly PaneTab[]): void {
    const live = new Set(tabs.map((tab) => tab.id));
    for (const id of layout.metas.keys()) {
      if (!live.has(id)) layout.metas.delete(id);
    }
    for (const tab of tabs) {
      const meta = this.meta(layout, tab);
      if (!tab.pinned) {
        meta.pinnedUrl = null;
        meta.folderId = null;
      } else if (meta.pinnedUrl === null && tab.currentUrl() !== BLANK) {
        meta.pinnedUrl = tab.currentUrl();
      }
    }
  }

  private noteShown(layout: ProfileLayout, active: PaneTab | undefined): void {
    const activeId = active?.id ?? null;
    if (activeId === layout.lastActive) return;
    const now = this.now();
    const before = layout.lastActive === null ? undefined : layout.metas.get(layout.lastActive);
    if (before) before.shownAt = now;
    if (active) this.meta(layout, active).shownAt = now;
    layout.lastActive = activeId;
  }

  settle(profile: BrowserProfile): boolean {
    const layout = this.layout(profile);
    const panes = this.panes();
    const tabs = panes.tabsOf(profile).filter((tab) => !tab.peek);
    this.settlePlaces(layout, tabs);
    const active = tabs.find((tab) => tab.active);
    if (active && this.meta(layout, active).spaceId === layout.currentSpaceId) {
      this.noteShown(layout, active);
      return false;
    }
    const front = this.frontTab(layout, tabs);
    if (front) {
      panes.select(profile, front.id);
      return true;
    }
    if (active) {
      for (const tab of tabs) tab.active = false;
      panes.layout();
    }
    this.noteShown(layout, undefined);
    return false;
  }

  followTab(profile: BrowserProfile, tabId: string): void {
    const layout = this.layout(profile);
    const meta = layout.metas.get(tabId);
    if (meta) layout.currentSpaceId = meta.spaceId;
  }

  sweep(profile: BrowserProfile): void {
    const setting = this.saved.archive();
    if (!setting.on) return;
    const layout = this.layout(profile);
    const panes = this.panes();
    const tabs = panes.tabsOf(profile).filter((tab) => !tab.peek);
    const now = this.now();
    const facts = tabs.map((tab): ArchiveFacts => {
      const meta = this.meta(layout, tab);
      return {
        id: tab.id,
        url: tab.currentUrl(),
        pinned: tab.pinned,
        spaceId: meta.spaceId,
        shownAt: meta.shownAt,
        audible: tab.contents()?.isCurrentlyAudible() ?? false,
        busy: tab.handoff !== null || tab.picking || tab.agentBusy > 0,
        showing: tab.active,
      };
    });
    const due = tabsToArchive(
      facts,
      this.saved.get(profile).favorites,
      setting.afterMinutes * MINUTE_MS,
      now,
    );
    const closing = tabs.filter((tab) => due.includes(tab.id));
    addArchived(
      layout,
      closing
        .filter((tab) => webPage(tab.currentUrl()))
        .map((tab) => archivedEntry(tab.currentUrl(), tab.currentTitle(), now)),
    );
    for (const tab of closing) panes.close(profile, tab.id);
  }

  takeArchived(profile: BrowserProfile, id: string): string | null {
    const layout = this.layout(profile);
    const entry = layout.archived.find((tab) => tab.id === id);
    if (!entry) return null;
    layout.archived = layout.archived.filter((tab) => tab.id !== id);
    return entry.url;
  }
}
