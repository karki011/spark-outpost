import {
  BrowserWindow,
  WebContentsView,
  type ContextMenuParams,
  type Input,
  type Session,
  type WebContents,
} from 'electron';
import {
  browserPlaceOf,
  browserShortcut,
  classifyBrowserUrl,
  type BrowserShortcut,
  type BrowserHandoff,
  type BrowserPaneTab,
  type BrowserTabOwner,
} from '@spark-outpost/contracts';
import { attachCdp, type Cdp } from './cdp.ts';
import type { InputMarks } from './clipboard-permission.ts';
import { capturePageLogs, type PageLogs } from './page-capture.ts';
import { RefMap, tabRefNumbers } from './ref-map.ts';
import { navigationAllowed } from './request-guard.ts';
import { isAddShortcut, isDevtoolsShortcut } from './selection-menu.ts';
import type { TabFacts } from './tab-rules.ts';

export interface TabHooks {
  session(): Session;
  allowed(url: string): boolean;
  changed(): void;
  popup(url: string, opener: PaneTab): void;
  viewCreated(view: WebContentsView): void;
  viewClosed(view: WebContentsView): void;
  gone(tab: PaneTab): void;
  visited(url: string): void;
  contextMenu(tab: PaneTab, params: ContextMenuParams): void;
  addShortcut(tab: PaneTab): void;
  paneShortcut(tab: PaneTab, shortcut: BrowserShortcut): void;
  found(tab: PaneTab, active: number, matches: number): void;
  devtoolsSession(): Session;
}

export interface TabInit {
  id: string;
  chatId: string;
  owner: BrowserTabOwner;
  runId: string | null;
  url: string;
}

export interface LiveTab {
  view: WebContentsView;
  cdp: Cdp;
  logs: PageLogs;
}

const BLANK = 'about:blank';
const BLOCKED = 'Spark does not let a page in the Browser pane go to that address.';
const VIEW_RADIUS = 10;

export const TAB_CLOSED = 'The user closed this tab.';

export class TabClosedError extends Error {
  constructor() {
    super(TAB_CLOSED);
  }
}

const MENU_SHORTCUTS: ReadonlySet<BrowserShortcut> = new Set([
  'close_tab',
  'reload',
  'hard_reload',
]);

function paneShortcutOf(input: Input): BrowserShortcut | null {
  const shortcut = browserShortcut(
    {
      code: input.code,
      meta: input.meta,
      ctrl: input.control,
      shift: input.shift,
      alt: input.alt,
      composing: input.isComposing,
    },
    process.platform === 'darwin',
  );
  return shortcut && !MENU_SHORTCUTS.has(shortcut) ? shortcut : null;
}

export class PaneTab {
  readonly id: string;
  readonly chatId: string;
  readonly refs = new RefMap(tabRefNumbers);
  readonly filled = new Set<number>();
  owner: BrowserTabOwner;
  runId: string | null;
  pinned = false;
  kept = false;
  handoff: BrowserHandoff | null = null;
  handoffRun: string | null = null;
  agentBusy = 0;
  agentDoneAt: number | null = null;
  private userInputAt: number | null = null;
  active = false;
  shown = false;
  picking = false;
  driving = false;
  lastAction: string | null = null;
  lastUsed = Date.now();
  status: number | null = null;
  error: string | null = null;
  private url: string;
  private title = '';
  private loading = false;
  private live: LiveTab | null = null;
  private opening: Promise<LiveTab> | null = null;
  private waking: Promise<LiveTab> | null = null;
  private readonly hooks: TabHooks;
  private devtools: BrowserWindow | null = null;
  private closed = false;

  constructor(init: TabInit, hooks: TabHooks) {
    this.id = init.id;
    this.chatId = init.chatId;
    this.owner = init.owner;
    this.runId = init.runId;
    this.url = init.url;
    this.hooks = hooks;
  }

  currentUrl(): string {
    const contents = this.live?.view.webContents;
    return contents && !contents.isDestroyed() ? contents.getURL() || this.url : this.url;
  }

  currentTitle(): string {
    return this.title;
  }

  openDevtools(): void {
    const contents = this.live?.view.webContents;
    if (!contents || contents.isDestroyed()) return;
    if (this.devtools && !this.devtools.isDestroyed()) {
      this.devtools.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 1000,
      height: 700,
      title: `Developer tools: ${this.title || 'Browser pane'}`,
      webPreferences: {
        session: this.hooks.devtoolsSession(),
        sandbox: true,
        contextIsolation: true,
      },
    });
    this.devtools = window;
    contents.setDevToolsWebContents(window.webContents);
    contents.openDevTools({ mode: 'detach' });
    contents.once('devtools-closed', () => {
      if (!window.isDestroyed()) window.close();
    });
    window.on('closed', () => {
      if (this.devtools === window) this.devtools = null;
      if (!contents.isDestroyed()) contents.closeDevTools();
    });
  }

  private closeDevtools(): void {
    const window = this.devtools;
    this.devtools = null;
    if (window && !window.isDestroyed()) window.close();
  }

  inputMarks(): InputMarks {
    return {
      shown: this.shown,
      agentBusy: this.agentBusy,
      userInputAt: this.userInputAt,
      agentDoneAt: this.agentDoneAt,
    };
  }

  forgetLogs(): void {
    this.live?.logs.reset();
  }

  view(): WebContentsView | null {
    return this.live?.view ?? null;
  }

  contents(): WebContents | null {
    const contents = this.live?.view.webContents;
    return contents && !contents.isDestroyed() ? contents : null;
  }

  facts(): TabFacts {
    return {
      id: this.id,
      url: this.currentUrl(),
      owner: this.owner,
      active: this.active,
      pinned: this.pinned || this.kept,
      failed: this.error !== null,
      lastUsed: this.lastUsed,
    };
  }

  paneTab(): BrowserPaneTab {
    const contents = this.live?.view.webContents;
    const history = contents && !contents.isDestroyed() ? contents.navigationHistory : null;
    const url = this.currentUrl();
    return {
      id: this.id,
      title: this.title.slice(0, 300),
      url: url === BLANK ? '' : url.slice(0, 4096),
      owner: this.owner,
      active: this.active,
      place: browserPlaceOf(url),
      loading: this.loading,
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
      pinned: this.pinned,
      kept: this.kept,
      handoff: this.handoff,
      driving: this.driving,
      picking: this.picking,
      lastAction: this.lastAction,
      error: this.error,
    };
  }

  touch(): void {
    this.lastUsed = Date.now();
  }

  async ensure(): Promise<LiveTab> {
    if (this.closed) throw new TabClosedError();
    if (this.live) return this.live;
    this.opening ??= this.open().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private steer(event: { preventDefault(): void }, url: string, redirect: boolean): void {
    const web = navigationAllowed(url);
    if (web && this.hooks.allowed(url)) return;
    event.preventDefault();
    if (redirect || web) this.note({ loading: false, error: BLOCKED });
  }

  private async open(): Promise<LiveTab> {
    const view = new WebContentsView({
      webPreferences: {
        session: this.hooks.session(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    view.setBorderRadius(VIEW_RADIUS);
    view.setVisible(false);
    const contents = view.webContents;
    await contents.loadURL(BLANK);
    contents.setWindowOpenHandler(({ url }) => {
      if (classifyBrowserUrl(url) !== 'blocked') this.hooks.popup(url, this);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => this.steer(event, url, false));
    contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
      if (isMainFrame) this.steer(event, url, true);
    });
    contents.on('did-start-loading', () => this.note({ loading: true, error: null }));
    contents.on('did-stop-loading', () => this.note({ loading: false }));
    contents.on('page-title-updated', (_event, title) => this.note({ title }));
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.live?.logs.reset();
    });
    contents.on('did-navigate', (_event, url, code) => {
      this.refs.clear();
      this.filled.clear();
      this.status = code > 0 ? code : null;
      this.url = url;
      this.hooks.visited(url);
      this.hooks.changed();
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      this.refs.movedInPage();
      this.hooks.changed();
    });
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      this.note({ loading: false, error: description || 'The page did not load.' });
    });
    contents.on('found-in-page', (_event, result) => {
      if (result.finalUpdate) this.hooks.found(this, result.activeMatchOrdinal, result.matches);
    });
    contents.on('context-menu', (_event, params) => this.hooks.contextMenu(this, params));
    contents.on('before-mouse-event', (_event, mouse) => {
      if (mouse.type === 'mouseDown') this.userUsed();
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown') this.userUsed();
      const shortcut =
        input.type === 'keyDown' && this.agentBusy === 0 ? paneShortcutOf(input) : null;
      if (shortcut) {
        event.preventDefault();
        this.hooks.paneShortcut(this, shortcut);
        return;
      }
      if (isDevtoolsShortcut(input, process.platform)) {
        event.preventDefault();
        this.openDevtools();
        return;
      }
      if (!isAddShortcut(input, process.platform)) return;
      event.preventDefault();
      this.hooks.addShortcut(this);
    });
    contents.on('render-process-gone', () => this.note({ error: 'The page stopped working.' }));
    const cdp = attachCdp(contents);
    const logs = await capturePageLogs(cdp);
    await cdp.send('Page.enable');
    if (this.closed || contents.isDestroyed()) {
      this.discard({ view, cdp, logs });
      throw new TabClosedError();
    }
    contents.once('destroyed', () => {
      if (this.live?.view === view) this.hooks.gone(this);
    });
    this.live = { view, cdp, logs };
    this.hooks.viewCreated(view);
    return this.live;
  }

  private userUsed(): void {
    if (this.agentBusy === 0) this.userInputAt = Date.now();
    if (this.owner !== 'agent' || this.agentBusy > 0 || this.kept) return;
    this.kept = true;
    this.hooks.changed();
  }

  keep(): void {
    if (this.owner !== 'agent' || this.kept) return;
    this.kept = true;
    this.hooks.changed();
  }

  private note(change: { loading?: boolean; title?: string; error?: string | null }): void {
    if (change.loading !== undefined) this.loading = change.loading;
    if (change.title !== undefined) this.title = change.title;
    if (change.error !== undefined) this.error = change.error;
    this.hooks.changed();
  }

  async load(url: string, signal?: AbortSignal): Promise<void> {
    const { view } = await this.ensure();
    this.url = url;
    this.title = '';
    this.error = null;
    this.status = null;
    this.touch();
    const contents = view.webContents;
    const stop = () => contents.stop();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      await contents.loadURL(url);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ERR_ABORTED') this.error ??= (error as Error).message.slice(0, 300);
    } finally {
      signal?.removeEventListener('abort', stop);
    }
    this.hooks.changed();
  }

  wake(): Promise<LiveTab> {
    if (this.live) return Promise.resolve(this.live);
    this.waking ??= this.ensure()
      .then(async (live) => {
        if (this.url !== BLANK) await this.load(this.url);
        return live;
      })
      .finally(() => {
        this.waking = null;
      });
    return this.waking;
  }

  find(text: string, forward: boolean, next: boolean): void {
    const contents = this.live?.view.webContents;
    if (!contents || contents.isDestroyed()) return;
    contents.findInPage(text, { forward, findNext: !next, matchCase: false });
  }

  stopFind(): void {
    const contents = this.live?.view.webContents;
    if (contents && !contents.isDestroyed()) contents.stopFindInPage('clearSelection');
  }

  history(step: 'back' | 'forward' | 'reload' | 'hard_reload' | 'stop'): boolean {
    const contents = this.live?.view.webContents;
    if (!contents || contents.isDestroyed()) return false;
    const history = contents.navigationHistory;
    if (step === 'back' && !history.canGoBack()) return false;
    if (step === 'forward' && !history.canGoForward()) return false;
    if (step === 'back') history.goBack();
    if (step === 'forward') history.goForward();
    if (step === 'reload') contents.reload();
    if (step === 'hard_reload') contents.reloadIgnoringCache();
    if (step === 'stop') contents.stop();
    this.touch();
    return true;
  }

  close(): void {
    this.closed = true;
    this.handoff = null;
    this.handoffRun = null;
    this.sleep();
  }

  sleep(): void {
    const live = this.live;
    if (!live) return;
    this.url = this.currentUrl();
    this.closeDevtools();
    this.live = null;
    this.shown = false;
    this.loading = false;
    this.picking = false;
    this.lastAction = null;
    this.refs.clear();
    this.filled.clear();
    this.discard(live);
  }

  private discard(live: LiveTab): void {
    for (const step of [
      () => live.logs.stop(),
      () => live.cdp.detach(),
      () => this.hooks.viewClosed(live.view),
      () => {
        if (!live.view.webContents.isDestroyed()) live.view.webContents.close();
      },
    ]) {
      try {
        step();
      } catch {
        continue;
      }
    }
  }
}
