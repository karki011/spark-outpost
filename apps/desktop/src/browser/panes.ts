import { randomUUID } from 'node:crypto';
import type { BrowserWindow, WebContentsView } from 'electron';
import {
  BROWSER_TABS_MAX,
  browserOrigin,
  classifyBrowserUrl,
  type BrowserBounds,
  type BrowserPaneState,
  type BrowserPlacement,
  type BrowserTabOwner,
} from '@spark-outpost/contracts';
import { partitionFor, type GuardFacts } from './request-guard.ts';
import { browserSession } from './sessions.ts';
import { PaneTab } from './tab.ts';

export interface PanesOptions {
  window(): BrowserWindow | null;
  blockedPorts(): ReadonlySet<number>;
  stateChanged(state: BrowserPaneState): void;
  snapshot(chatId: string, image: string | null): void;
  localOriginSeen(projectId: string, origin: string): void;
  log(line: string): void;
  idleMs?: number;
}

export interface ChatHome {
  projectId: string | null;
  keepSignIns: boolean;
  roots: readonly string[];
}

interface ChatPane {
  chatId: string;
  tabs: PaneTab[];
  home: ChatHome;
  idle: NodeJS.Timeout | null;
  notify: boolean;
}

const BLANK = 'about:blank';
const IDLE_MS = 10 * 60_000;
const DRIVING_HOLD_MS = 1200;
const HIDDEN_BOUNDS = { x: 0, y: 0, width: 1280, height: 800 };
const SNAPSHOT_QUALITY = 70;

export class BrowserPanes {
  private readonly chats = new Map<string, ChatPane>();
  private readonly rootsByPartition = new Map<string, Set<string>>();
  private readonly driving = new Map<string, NodeJS.Timeout>();
  private placement: BrowserPlacement | null = null;
  private readonly options: PanesOptions;

  constructor(options: PanesOptions) {
    this.options = options;
  }

  private chat(chatId: string, home?: ChatHome): ChatPane {
    let pane = this.chats.get(chatId);
    if (!pane) {
      pane = {
        chatId,
        tabs: [],
        home: home ?? { projectId: null, keepSignIns: true, roots: [] },
        idle: null,
        notify: false,
      };
      this.chats.set(chatId, pane);
    }
    if (home) {
      pane.home = home;
      this.allowRoots(pane);
    }
    return pane;
  }

  private partitionOf(pane: ChatPane): string {
    return partitionFor({
      chatId: pane.chatId,
      projectId: pane.home.projectId,
      keepSignIns: pane.home.keepSignIns,
    });
  }

  private allowRoots(pane: ChatPane): void {
    const partition = this.partitionOf(pane);
    const roots = this.rootsByPartition.get(partition) ?? new Set<string>();
    for (const root of pane.home.roots) roots.add(root);
    this.rootsByPartition.set(partition, roots);
  }

  guardFacts(chatId: string): GuardFacts {
    const pane = this.chats.get(chatId);
    const roots = pane ? (this.rootsByPartition.get(this.partitionOf(pane)) ?? []) : [];
    return { blockedPorts: this.options.blockedPorts(), roots: [...roots] };
  }

  tabsOf(chatId: string): readonly PaneTab[] {
    return this.chats.get(chatId)?.tabs ?? [];
  }

  tab(chatId: string, tabId: string): PaneTab | null {
    return this.tabsOf(chatId).find((tab) => tab.id === tabId) ?? null;
  }

  state(chatId: string): BrowserPaneState {
    return { chatId, tabs: this.tabsOf(chatId).map((tab) => tab.paneTab()) };
  }

  private changed(pane: ChatPane): void {
    if (pane.notify) return;
    pane.notify = true;
    setImmediate(() => {
      pane.notify = false;
      this.options.stateChanged(this.state(pane.chatId));
    });
  }

  touch(chatId: string, home?: ChatHome): void {
    const pane = this.chat(chatId, home);
    this.scheduleIdle(pane);
  }

  private scheduleIdle(pane: ChatPane): void {
    if (pane.idle) clearTimeout(pane.idle);
    pane.idle = null;
    if (this.shown(pane.chatId)) return;
    pane.idle = setTimeout(() => {
      pane.idle = null;
      if (this.shown(pane.chatId)) return;
      for (const tab of pane.tabs) tab.sleep();
      this.changed(pane);
    }, this.options.idleMs ?? IDLE_MS);
    pane.idle.unref();
  }

  private shown(chatId: string): boolean {
    return this.placement?.chatId === chatId && this.placement.bounds !== null;
  }

  createTab(
    chatId: string,
    init: { owner: BrowserTabOwner; runId: string | null; url: string },
    home?: ChatHome,
  ): PaneTab | null {
    const pane = this.chat(chatId, home);
    if (pane.tabs.length >= BROWSER_TABS_MAX) return null;
    const partition = this.partitionOf(pane);
    const projectId = pane.home.keepSignIns ? pane.home.projectId : null;
    const tab: PaneTab = new PaneTab(
      { id: randomUUID().slice(0, 8), chatId, ...init },
      {
        session: () =>
          browserSession(partition, {
            blockedPorts: this.options.blockedPorts,
            roots: (name) => [...(this.rootsByPartition.get(name) ?? [])],
            log: this.options.log,
          }),
        changed: () => this.changed(pane),
        popup: (url, opener) => this.openPopup(pane, url, opener),
        viewCreated: (view) => this.attach(view),
        viewClosed: (view) => this.detach(view),
        visited: (url) => this.visited(pane, projectId, url),
      },
    );
    pane.tabs.push(tab);
    if (!pane.tabs.some((other) => other.active)) tab.active = true;
    this.changed(pane);
    return tab;
  }

  private visited(pane: ChatPane, projectId: string | null, url: string): void {
    const origin = browserOrigin(url);
    if (projectId && origin && classifyBrowserUrl(url) === 'local') {
      this.options.localOriginSeen(projectId, origin);
    }
    this.scheduleIdle(pane);
  }

  private openPopup(pane: ChatPane, url: string, opener: PaneTab): void {
    const tab = this.createTab(pane.chatId, {
      owner: opener.owner,
      runId: opener.runId,
      url: BLANK,
    });
    if (!tab) return;
    if (opener.active) this.select(pane.chatId, tab.id);
    void tab.load(url).then(() => this.layout());
  }

  private attach(view: WebContentsView): void {
    view.setBounds(HIDDEN_BOUNDS);
    this.options.window()?.contentView.addChildView(view);
    this.layout();
  }

  private detach(view: WebContentsView): void {
    const window = this.options.window();
    if (!window || window.isDestroyed()) return;
    window.contentView.removeChildView(view);
  }

  select(chatId: string, tabId: string): void {
    const pane = this.chats.get(chatId);
    if (!pane?.tabs.some((tab) => tab.id === tabId)) return;
    for (const tab of pane.tabs) tab.active = tab.id === tabId;
    this.tab(chatId, tabId)?.touch();
    this.changed(pane);
    this.layout();
  }

  close(chatId: string, tabId: string): void {
    const pane = this.chats.get(chatId);
    const tab = pane?.tabs.find((candidate) => candidate.id === tabId);
    if (!pane || !tab) return;
    tab.sleep();
    pane.tabs = pane.tabs.filter((candidate) => candidate !== tab);
    if (tab.active && pane.tabs.length > 0) pane.tabs.at(-1)!.active = true;
    this.changed(pane);
    this.layout();
  }

  closeRunTabs(chatId: string, runId: string): number {
    const closing = this.tabsOf(chatId).filter(
      (tab) => tab.owner === 'agent' && tab.runId === runId && !tab.pinned,
    );
    for (const tab of closing) this.close(chatId, tab.id);
    return closing.length;
  }

  noteChange(chatId: string): void {
    const pane = this.chats.get(chatId);
    if (pane) this.changed(pane);
  }

  async whileDriving<T>(tab: PaneTab, work: () => Promise<T>): Promise<T> {
    const held = this.driving.get(tab.id);
    if (held) clearTimeout(held);
    tab.driving = true;
    tab.touch();
    this.noteChange(tab.chatId);
    try {
      return await work();
    } finally {
      const timer = setTimeout(() => {
        this.driving.delete(tab.id);
        tab.driving = false;
        this.noteChange(tab.chatId);
      }, DRIVING_HOLD_MS);
      timer.unref();
      this.driving.set(tab.id, timer);
    }
  }

  async place(next: BrowserPlacement): Promise<void> {
    const before = this.placement;
    const home = { projectId: next.projectId, keepSignIns: next.keepSignIns, roots: next.roots };
    const pane = this.chat(next.chatId, home);
    if (next.covered && before?.chatId === next.chatId && !before.covered) {
      await this.sendSnapshot(pane);
    }
    this.placement = next;
    if (before && before.chatId !== next.chatId) {
      const previous = this.chats.get(before.chatId);
      if (previous) this.scheduleIdle(previous);
    }
    this.scheduleIdle(pane);
    if (next.bounds !== null) await this.wakeActive(pane);
    this.layout();
    if (!next.covered) this.options.snapshot(next.chatId, null);
  }

  private async wakeActive(pane: ChatPane): Promise<void> {
    const active = pane.tabs.find((tab) => tab.active);
    if (active && !active.view() && active.currentUrl() !== BLANK) await active.wake();
  }

  private async sendSnapshot(pane: ChatPane): Promise<void> {
    const view = pane.tabs.find((tab) => tab.active)?.view();
    if (!view || view.webContents.isDestroyed()) return;
    try {
      const image = await view.webContents.capturePage();
      if (image.isEmpty()) return;
      const jpeg = image.toJPEG(SNAPSHOT_QUALITY).toString('base64');
      this.options.snapshot(pane.chatId, `data:image/jpeg;base64,${jpeg}`);
    } catch {
      this.options.snapshot(pane.chatId, null);
    }
  }

  private zoomed(bounds: BrowserBounds): BrowserBounds {
    const contents = this.options.window()?.webContents;
    const zoom = contents && !contents.isDestroyed() ? contents.getZoomFactor() : 1;
    return {
      x: Math.round(bounds.x * zoom),
      y: Math.round(bounds.y * zoom),
      width: Math.round(bounds.width * zoom),
      height: Math.round(bounds.height * zoom),
    };
  }

  layout(): void {
    const placement = this.placement;
    for (const pane of this.chats.values()) {
      for (const tab of pane.tabs) {
        const view = tab.view();
        if (!view) continue;
        const visible =
          placement !== null &&
          placement.chatId === pane.chatId &&
          placement.bounds !== null &&
          placement.bounds.width > 0 &&
          placement.bounds.height > 0 &&
          !placement.covered &&
          tab.active &&
          tab.currentUrl() !== BLANK;
        if (visible) view.setBounds(this.zoomed(placement.bounds!));
        view.setVisible(visible);
      }
    }
  }

  sleepAll(): void {
    this.placement = null;
    for (const pane of this.chats.values()) {
      for (const tab of pane.tabs) tab.sleep();
    }
  }

  forget(chatId: string): void {
    const pane = this.chats.get(chatId);
    if (!pane) return;
    if (pane.idle) clearTimeout(pane.idle);
    for (const tab of pane.tabs) tab.sleep();
    this.chats.delete(chatId);
  }

  dispose(): void {
    for (const chatId of [...this.chats.keys()]) this.forget(chatId);
    for (const timer of this.driving.values()) clearTimeout(timer);
    this.driving.clear();
    this.placement = null;
  }
}
