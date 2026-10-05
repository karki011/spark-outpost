import { WebContentsView, type Session } from 'electron';
import {
  browserPlaceOf,
  classifyBrowserUrl,
  type BrowserPaneTab,
  type BrowserTabOwner,
} from '@spark-outpost/contracts';
import { attachCdp, type Cdp } from './cdp.ts';
import { RefMap } from './outline.ts';
import { capturePageLogs, type PageLogs } from './page-capture.ts';
import type { TabFacts } from './tab-rules.ts';

export interface TabHooks {
  session(): Session;
  changed(): void;
  popup(url: string, opener: PaneTab): void;
  viewCreated(view: WebContentsView): void;
  viewClosed(view: WebContentsView): void;
  visited(url: string): void;
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
const VIEW_RADIUS = 10;

export class PaneTab {
  readonly id: string;
  readonly chatId: string;
  readonly refs = new RefMap();
  readonly filled = new Set<number>();
  owner: BrowserTabOwner;
  runId: string | null;
  pinned = false;
  active = false;
  picking = false;
  driving = false;
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

  view(): WebContentsView | null {
    return this.live?.view ?? null;
  }

  facts(): TabFacts {
    return {
      id: this.id,
      url: this.currentUrl(),
      owner: this.owner,
      active: this.active,
      pinned: this.pinned,
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
      driving: this.driving,
      picking: this.picking,
      error: this.error,
    };
  }

  touch(): void {
    this.lastUsed = Date.now();
  }

  async ensure(): Promise<LiveTab> {
    if (this.live) return this.live;
    this.opening ??= this.open().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async open(): Promise<LiveTab> {
    const view = new WebContentsView({
      webPreferences: {
        session: this.hooks.session(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
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
    contents.on('will-navigate', (event, url) => {
      if (classifyBrowserUrl(url) === 'blocked') event.preventDefault();
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
      this.hooks.changed();
    });
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      this.note({ loading: false, error: description || 'The page did not load.' });
    });
    contents.on('render-process-gone', () => this.note({ error: 'The page stopped working.' }));
    const cdp = attachCdp(contents);
    const logs = await capturePageLogs(cdp);
    await cdp.send('Page.enable');
    this.live = { view, cdp, logs };
    this.hooks.viewCreated(view);
    return this.live;
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

  history(step: 'back' | 'forward' | 'reload' | 'stop'): void {
    const contents = this.live?.view.webContents;
    if (!contents || contents.isDestroyed()) return;
    if (step === 'back') contents.navigationHistory.goBack();
    if (step === 'forward') contents.navigationHistory.goForward();
    if (step === 'reload') contents.reload();
    if (step === 'stop') contents.stop();
    this.touch();
  }

  sleep(): void {
    const live = this.live;
    if (!live) return;
    this.url = this.currentUrl();
    this.live = null;
    this.loading = false;
    this.picking = false;
    this.refs.clear();
    this.filled.clear();
    for (const step of [
      () => live.logs.stop(),
      () => live.cdp.detach(),
      () => this.hooks.viewClosed(live.view),
      () => live.view.webContents.close(),
    ]) {
      try {
        step();
      } catch {
        continue;
      }
    }
  }
}
