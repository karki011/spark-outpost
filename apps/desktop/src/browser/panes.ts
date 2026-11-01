import { randomUUID } from 'node:crypto';
import type {
  BrowserWindow,
  ContextMenuParams,
  Input,
  WebContents,
  WebContentsView,
} from 'electron';
import {
  BROWSER_TABS_MAX,
  browserOrigin,
  classifyBrowserUrl,
  type BrowserBounds,
  type BrowserClosedTab,
  type BrowserPaneState,
  type BrowserPlacement,
  type BrowserShortcut,
  type BrowserTabOwner,
} from '@spark-outpost/contracts';
import { CLIPBOARD_WRITE, pagePermissionAllowed, type InputMarks } from './clipboard-permission.ts';
import { BROWSER_PARTITION, requestAllowed, type GuardFacts } from './request-guard.ts';
import type { SendsTo } from './selection-menu.ts';
import { browserSession, devtoolsSession, type SessionGuards } from './sessions.ts';
import { PaneTab } from './tab.ts';

export interface PanesOptions {
  window(): BrowserWindow | null;
  blockedPorts(): ReadonlySet<number>;
  stateChanged(state: BrowserPaneState): void;
  snapshot(chatId: string, image: string | null): void;
  localOriginSeen(projectId: string, origin: string): void;
  contextMenu(tab: PaneTab, params: ContextMenuParams): void;
  addShortcut(tab: PaneTab): void;
  paneShortcut(tab: PaneTab, shortcut: BrowserShortcut): void;
  found(tab: PaneTab, active: number, matches: number): void;
  log(line: string): void;
  idleMs?: number;
  tabsMax?: number;
  partition?(key: string): string;
  guards?: SessionGuards;
  visited?(tab: PaneTab, url: string, sameDocument: boolean): void;
  titled?(tab: PaneTab, title: string): void;
  shiftedLink?(opener: PaneTab, url: string): boolean;
  slotBounds?(tab: PaneTab): BrowserBounds | null | undefined;
  tabUsed?(tab: PaneTab): void;
  pageKey?(tab: PaneTab, input: Input): boolean;
}

export interface ChatHome {
  projectId: string | null;
  roots: readonly string[];
}

interface ChatPane {
  chatId: string;
  tabs: PaneTab[];
  home: ChatHome;
  sendsTo: SendsTo;
  idle: NodeJS.Timeout | null;
  notify: boolean;
  closed: string[];
}

const BLANK = 'about:blank';
const IDLE_MS = 10 * 60_000;
const DRIVING_HOLD_MS = 1200;
const HIDDEN_BOUNDS = { x: 0, y: 0, width: 1280, height: 800 };
const SNAPSHOT_QUALITY = 70;
const CLOSED_KEPT = 20;

export class BrowserPanes {
  private readonly chats = new Map<string, ChatPane>();
  private readonly driving = new Map<string, NodeJS.Timeout>();
  private readonly byContents = new Map<number, PaneTab>();
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
        home: home ?? { projectId: null, roots: [] },
        sendsTo: 'chat',
        idle: null,
        notify: false,
        closed: [],
      };
      this.chats.set(chatId, pane);
    }
    if (home) pane.home = home;
    return pane;
  }

  private rootsOf(chatId: string | null): string[] {
    const pane = chatId ? this.chats.get(chatId) : undefined;
    return pane ? [...pane.home.roots] : [];
  }

  guardFacts(chatId: string): GuardFacts {
    return { blockedPorts: this.options.blockedPorts(), roots: this.rootsOf(chatId) };
  }

  sendsTo(chatId: string): SendsTo {
    return this.chats.get(chatId)?.sendsTo ?? 'chat';
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

  touch(chatId: string, home?: ChatHome, sendsTo?: SendsTo): void {
    const pane = this.chat(chatId, home);
    if (sendsTo) pane.sendsTo = sendsTo;
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
    init: {
      owner: BrowserTabOwner;
      runId: string | null;
      url: string;
      title?: string;
      peek?: boolean;
    },
    home?: ChatHome,
  ): PaneTab | null {
    const pane = this.chat(chatId, home);
    if (pane.tabs.length >= (this.options.tabsMax ?? BROWSER_TABS_MAX)) return null;
    const tab: PaneTab = new PaneTab(
      { id: randomUUID().slice(0, 8), chatId, ...init },
      {
        allowed: (url) => requestAllowed(url, this.guardFacts(pane.chatId)),
        session: () =>
          browserSession(
            this.options.partition?.(pane.chatId) ?? BROWSER_PARTITION,
            this.options.guards ?? this.ownGuards(),
          ),
        changed: () => this.changed(pane),
        popup: (url, opener, shifted) => this.openPopup(pane, url, opener, shifted),
        viewCreated: (view) => this.attach(view, tab),
        viewClosed: (view) => this.detach(view, tab),
        gone: (owner) => this.close(chatId, owner.id),
        visited: (url, sameDocument) => {
          this.visited(pane, url);
          this.options.visited?.(tab, url, sameDocument);
        },
        titled: (title) => this.options.titled?.(tab, title),
        contextMenu: (owner, params) => this.options.contextMenu(owner, params),
        addShortcut: (owner) => this.options.addShortcut(owner),
        paneShortcut: (owner, shortcut) => this.options.paneShortcut(owner, shortcut),
        found: (owner, active, matches) => this.options.found(owner, active, matches),
        devtoolsSession: () =>
          devtoolsSession({ blockedPorts: this.options.blockedPorts, log: this.options.log }),
        used: (owner) => this.options.tabUsed?.(owner),
        pageKey: (owner, input) => this.options.pageKey?.(owner, input) ?? false,
      },
    );
    pane.tabs.push(tab);
    if (!tab.peek && !pane.tabs.some((other) => other.active)) tab.active = true;
    this.changed(pane);
    return tab;
  }

  private visited(pane: ChatPane, url: string): void {
    const projectId = pane.home.projectId;
    const origin = browserOrigin(url);
    if (projectId && origin && classifyBrowserUrl(url) === 'local') {
      this.options.localOriginSeen(projectId, origin);
    }
    this.scheduleIdle(pane);
  }

  private openPopup(pane: ChatPane, url: string, opener: PaneTab, shifted: boolean): void {
    if (shifted && this.options.shiftedLink?.(opener, url)) return;
    const tab = this.createTab(pane.chatId, {
      owner: opener.owner,
      runId: opener.runId,
      url: BLANK,
    });
    if (!tab) return;
    if (opener.active || opener.peek) this.select(pane.chatId, tab.id);
    void tab
      .load(url)
      .then(() => this.layout())
      .catch(() => undefined);
  }

  private ownGuards(): SessionGuards {
    return {
      blockedPorts: this.options.blockedPorts,
      roots: (contents) => this.rootsOfContents(contents),
      log: this.options.log,
      inputMarks: (contents) => this.inputMarks(contents),
    };
  }

  rootsOfContents(contents: WebContents | null): string[] {
    return this.rootsOf(this.tabOfContents(contents)?.chatId ?? null);
  }

  tabOfContents(contents: WebContents | null): PaneTab | null {
    return contents ? (this.byContents.get(contents.id) ?? null) : null;
  }

  inputMarks(contents: WebContents | null): InputMarks | null {
    return this.tabOfContents(contents)?.inputMarks() ?? null;
  }

  pageCopyAllowed(contents: WebContents): boolean {
    return pagePermissionAllowed(CLIPBOARD_WRITE, this.inputMarks(contents), Date.now());
  }

  private attach(view: WebContentsView, tab: PaneTab): void {
    this.byContents.set(view.webContents.id, tab);
    view.setBounds(HIDDEN_BOUNDS);
    this.options.window()?.contentView.addChildView(view);
    this.layout();
  }

  private detach(view: WebContentsView, tab: PaneTab): void {
    for (const [id, owner] of this.byContents) {
      if (owner === tab) this.byContents.delete(id);
    }
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
    pane.tabs = pane.tabs.filter((candidate) => candidate !== tab);
    const next = pane.tabs.filter((candidate) => !candidate.peek).at(-1);
    if (tab.active && next) next.active = true;
    this.changed(pane);
    try {
      tab.close();
    } catch (error) {
      this.options.log(`Could not close a browser tab cleanly: ${(error as Error).message}`);
    }
    this.layout();
  }

  resync(chatId: string): void {
    this.options.stateChanged(this.state(chatId));
  }

  keepFocus(chatId: string, change: () => void): void {
    const focused = this.tabsOf(chatId).some((tab) => tab.contents()?.isFocused() ?? false);
    change();
    if (!focused) return;
    const active = this.tabsOf(chatId).find((tab) => tab.active);
    const contents = active?.contents();
    if (contents) contents.focus();
    else this.options.window()?.webContents.focus();
  }

  closeByUser(chatId: string, tabId: string): BrowserClosedTab {
    const pane = this.chats.get(chatId);
    const tab = this.tab(chatId, tabId);
    const url = tab?.currentUrl();
    if (pane && url && url !== BLANK) pane.closed = [...pane.closed, url].slice(-CLOSED_KEPT);
    const closed = { handoff: tab?.handoff ?? null };
    this.close(chatId, tabId);
    return closed;
  }

  takeClosed(chatId: string): string | null {
    return this.chats.get(chatId)?.closed.pop() ?? null;
  }

  closeRunTabs(chatId: string, runId: string): number {
    const closing = this.tabsOf(chatId).filter(
      (tab) => tab.owner === 'agent' && tab.runId === runId && !tab.pinned && !tab.kept,
    );
    for (const tab of closing) this.close(chatId, tab.id);
    this.noteChange(chatId);
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
    tab.agentBusy += 1;
    tab.touch();
    this.noteChange(tab.chatId);
    try {
      return await work();
    } finally {
      tab.agentBusy -= 1;
      tab.agentDoneAt = Date.now();
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
    const home = { projectId: next.projectId, roots: next.roots };
    const pane = this.chat(next.chatId, home);
    pane.sendsTo = next.sendsTo;
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

  wakeShowing(chatId: string): void {
    const pane = this.chats.get(chatId);
    if (pane && this.shown(chatId)) void this.wakeActive(pane).catch(() => undefined);
  }

  async capture(tab: PaneTab): Promise<string | null> {
    const view = tab.view();
    if (!view || view.webContents.isDestroyed()) return null;
    const image = await view.webContents.capturePage();
    if (image.isEmpty()) return null;
    return `data:image/jpeg;base64,${image.toJPEG(SNAPSHOT_QUALITY).toString('base64')}`;
  }

  private async sendSnapshot(pane: ChatPane): Promise<void> {
    const active = pane.tabs.find((tab) => tab.active);
    if (!active?.view() || active.view()!.webContents.isDestroyed()) return;
    try {
      const image = await this.capture(active);
      if (image) this.options.snapshot(pane.chatId, image);
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
        const slot = this.options.slotBounds?.(tab);
        const showsActive =
          placement?.chatId === pane.chatId && !placement.covered && tab.active && !tab.peek;
        const bounds = slot !== undefined ? slot : showsActive ? placement.bounds : null;
        const visible =
          bounds !== null && bounds.width > 0 && bounds.height > 0 && tab.currentUrl() !== BLANK;
        if (visible) view.setBounds(this.zoomed(bounds));
        view.setVisible(visible);
        tab.shown = visible;
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
    for (const tab of pane.tabs) tab.close();
    this.chats.delete(chatId);
  }

  dispose(): void {
    for (const chatId of [...this.chats.keys()]) this.forget(chatId);
    for (const timer of this.driving.values()) clearTimeout(timer);
    this.driving.clear();
    this.placement = null;
  }
}
