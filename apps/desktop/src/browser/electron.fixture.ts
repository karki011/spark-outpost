import { EventEmitter } from 'node:events';
import type { Cdp, CdpListener } from './cdp.ts';

type RequestVerdict = (answer: { cancel?: boolean }) => void;
type RequestHandler = (
  details: { url: string; webContents?: unknown },
  callback: RequestVerdict,
) => void;
type HeaderVerdict = (answer: { requestHeaders: Record<string, string> }) => void;
type HeaderHandler = (
  details: { url: string; requestHeaders: Record<string, string> },
  callback: HeaderVerdict,
) => void;
type PermissionHandler = (
  contents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
) => void;

type PermissionCheck = (contents: unknown, permission: string) => boolean;

export interface Request {
  partition: string;
  url: string;
  cookie: string | null;
}

export class FakeNet {
  readonly redirects = new Map<string, string>();
  readonly requests: Request[] = [];
  readonly sessions = new Map<string, FakeSession>();
  readonly views: FakeView[] = [];
  answer: (method: string, params: Record<string, unknown>, url: string) => unknown = () => ({});

  reset(): void {
    this.redirects.clear();
    this.requests.length = 0;
    this.sessions.clear();
    this.views.length = 0;
    this.answer = () => ({});
  }

  liveViews(): FakeView[] {
    return this.views.filter((view) => !view.webContents.isDestroyed());
  }
}

export const net = new FakeNet();

export class FakeSession extends EventEmitter {
  readonly cookies = new Map<string, string>();
  private beforeRequest: RequestHandler | null = null;
  private beforeHeaders: HeaderHandler | null = null;
  private permission: PermissionHandler | null = null;
  private check: PermissionCheck | null = null;
  private device: (() => boolean) | null = null;

  readonly webRequest = {
    onBeforeRequest: (handler: RequestHandler) => {
      this.beforeRequest = handler;
    },
    onBeforeSendHeaders: (handler: HeaderHandler) => {
      this.beforeHeaders = handler;
    },
  };

  constructor(readonly partition: string) {
    super();
  }

  setPermissionRequestHandler(handler: PermissionHandler): void {
    this.permission = handler;
  }

  setPermissionCheckHandler(handler: PermissionCheck): void {
    this.check = handler;
  }

  setDevicePermissionHandler(handler: () => boolean): void {
    this.device = handler;
  }

  readonly preloads: string[] = [];

  registerPreloadScript(script: { filePath: string }): string {
    this.preloads.push(script.filePath);
    return script.filePath;
  }

  requestCancelled(url: string, webContents?: unknown): boolean {
    let cancelled = false;
    this.beforeRequest?.({ url, webContents }, (answer) => {
      cancelled = answer.cancel === true;
    });
    return cancelled;
  }

  headersSent(url: string, requestHeaders: Record<string, string>): Record<string, string> {
    let sent = requestHeaders;
    this.beforeHeaders?.({ url, requestHeaders }, (answer) => {
      sent = answer.requestHeaders;
    });
    return sent;
  }

  permissionGranted(permission: string, contents: unknown = null): boolean {
    let granted = true;
    this.permission?.(contents, permission, (answer) => {
      granted = answer;
    });
    return granted || this.check?.(contents, permission) !== false || this.device?.() !== false;
  }

  permissionAnswers(permission: string, contents: unknown): { request: boolean; check: boolean } {
    let request = true;
    this.permission?.(contents, permission, (answer) => {
      request = answer;
    });
    return { request, check: this.check?.(contents, permission) !== false };
  }

  downloadCancelled(): boolean {
    let prevented = false;
    this.emit('will-download', { preventDefault: () => (prevented = true) });
    return prevented;
  }
}

function prevention() {
  const event = { prevented: false, preventDefault: () => (event.prevented = true) };
  return event;
}

function hostOf(url: string): string {
  return new URL(url).host;
}

let contentsIds = 0;

export class FakeContents extends EventEmitter {
  readonly id = ++contentsIds;
  url = '';
  destroyed = false;
  focused = false;
  blocksUnload = false;
  audible = false;
  private opener: ((details: { url: string }) => { action: string }) | null = null;
  private readonly cdpListeners = new Set<CdpListener>();
  readonly navigationHistory = {
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: () => undefined,
    goForward: () => undefined,
  };

  readonly cdp: Cdp = {
    send: (method, params = {}) => Promise.resolve(net.answer(method, params, this.url) as never),
    listen: (listener) => {
      this.cdpListeners.add(listener);
      return () => this.cdpListeners.delete(listener);
    },
    detach: () => this.cdpListeners.clear(),
  };

  constructor(readonly session: FakeSession) {
    super();
  }

  getURL(): string {
    return this.url;
  }

  cdpEmit(method: string, params: Record<string, unknown> = {}): void {
    for (const listener of this.cdpListeners) listener(method, params);
  }

  isCurrentlyAudible(): boolean {
    return this.audible;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFocused(): boolean {
    if (this.destroyed) throw new TypeError('Object has been destroyed');
    return this.focused;
  }

  close(options?: { waitForBeforeUnload?: boolean }): void {
    if (this.destroyed) throw new TypeError('Object has been destroyed');
    if (options?.waitForBeforeUnload && this.blocksUnload) {
      this.emit('will-prevent-unload', prevention());
      return;
    }
    this.destroyed = true;
    this.emit('destroyed');
  }

  crash(): void {
    this.emit('render-process-gone', {}, { reason: 'crashed' });
  }

  stop(): void {}

  reload(): void {}

  focus(): void {}

  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
    this.opener = handler;
  }

  windowOpen(url: string): string {
    return this.opener?.({ url }).action ?? 'allow';
  }

  private fetch(first: string): { url: string; failed: string | null } {
    let url = first;
    for (;;) {
      if (url !== 'about:blank') {
        if (this.session.requestCancelled(url, this)) {
          return { url, failed: 'ERR_BLOCKED_BY_CLIENT' };
        }
        net.requests.push({
          partition: this.session.partition,
          url,
          cookie: this.session.cookies.get(hostOf(url)) ?? null,
        });
      }
      const next = net.redirects.get(url);
      if (!next) return { url, failed: null };
      const event = prevention();
      this.emit('will-redirect', event, next, false, true);
      if (event.prevented) return { url, failed: 'ERR_ABORTED' };
      url = next;
    }
  }

  private commit(first: string): string | null {
    const { url, failed } = this.fetch(first);
    if (failed) {
      if (failed !== 'ERR_ABORTED') this.emit('did-fail-load', {}, -20, failed, url, true);
      return failed;
    }
    this.url = url;
    this.emit('did-navigate', {}, url, 200);
    return null;
  }

  loadURL(url: string): Promise<void> {
    const failed = this.commit(url);
    if (!failed) return Promise.resolve();
    return Promise.reject(Object.assign(new Error(failed), { code: failed }));
  }

  followLink(url: string): void {
    const event = prevention();
    this.emit('will-navigate', event, url);
    if (!event.prevented) this.commit(url);
  }
}

export class FakeView {
  readonly webContents: FakeContents;
  visible = false;

  constructor(options: { webPreferences: { session: FakeSession } }) {
    this.webContents = new FakeContents(options.webPreferences.session);
    net.views.push(this);
  }

  setBorderRadius(): void {}

  setBounds(): void {}

  setVisible(visible: boolean): void {
    this.visible = visible;
  }
}

const defaultSession = new FakeSession('');

export const fakeElectron = {
  WebContentsView: FakeView,
  session: {
    defaultSession,
    fromPartition(partition: string): FakeSession {
      let found = net.sessions.get(partition);
      if (!found) {
        found = new FakeSession(partition);
        net.sessions.set(partition, found);
      }
      return found;
    },
  },
};
