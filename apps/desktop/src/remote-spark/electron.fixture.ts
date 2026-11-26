import { EventEmitter } from 'node:events';

type Verdict = (answer: { cancel?: boolean }) => void;
type RequestHandler = (details: { url: string; resourceType: string }, callback: Verdict) => void;
type HeaderHandler = (
  details: { requestHeaders: Record<string, string> },
  callback: (answer: { requestHeaders: Record<string, string> }) => void,
) => void;
type PermissionHandler = (
  contents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
) => void;

export interface SetCookie {
  url: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  domain?: string;
}

export class FakeCookies extends EventEmitter {
  readonly placed: SetCookie[] = [];
  readonly held = new Map<string, string>();
  failing = false;

  get(filter: { url: string; name: string }): Promise<{ name: string; value: string }[]> {
    if (this.failing) return Promise.reject(new Error('The cookie store is closed.'));
    const value = this.held.get(`${new URL(filter.url).hostname} ${filter.name}`);
    return Promise.resolve(value === undefined ? [] : [{ name: filter.name, value }]);
  }

  set(details: SetCookie): Promise<void> {
    if (this.failing) return Promise.reject(new Error('The cookie store is closed.'));
    this.placed.push(details);
    this.hostSets(details.name, new URL(details.url).hostname, details.value);
    return Promise.resolve();
  }

  readonly removed: string[] = [];

  remove(url: string, name: string): Promise<void> {
    this.removed.push(`${url} ${name}`);
    this.held.delete(`${new URL(url).hostname} ${name}`);
    return Promise.resolve();
  }

  hostSets(name: string, domain: string, value: string): void {
    this.held.set(`${domain} ${name}`, value);
    this.emit('changed', {}, { name, domain, value }, 'inserted', false);
  }

  hostReplaces(name: string, domain: string, before: string, value: string): void {
    this.emit('changed', {}, { name, domain, value: before }, 'overwrite', true);
    this.hostSets(name, domain, value);
  }

  hostRemoves(name: string, domain: string, value: string): void {
    this.held.delete(`${domain} ${name}`);
    this.emit('changed', {}, { name, domain, value }, 'expired-overwrite', true);
  }
}

export type FakeAnswer = { status: number; body: unknown } | 'unreachable' | 'silent';

export interface FakeResponse {
  status: number;
  json(): Promise<unknown>;
}

interface FakeFetchInit {
  method?: string;
  credentials?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

interface FakeEndRequest {
  url: string;
  init: FakeFetchInit | undefined;
  clearedBefore: number;
}

function answered(status: number, body: unknown): FakeResponse {
  return {
    status,
    json: () =>
      body === undefined ? Promise.reject(new SyntaxError('Not JSON.')) : Promise.resolve(body),
  };
}

export class FakeSession extends EventEmitter {
  readonly cookies = new FakeCookies();
  cleared = 0;
  sessionStatus = 200;
  readonly fetched: string[] = [];
  readonly ended: FakeEndRequest[] = [];
  attention: FakeAnswer = { status: 200, body: { items: [] } };
  end: FakeAnswer = { status: 200, body: { ok: true } };

  fetch(url: string, init?: FakeFetchInit): Promise<FakeResponse> {
    const ending = url.endsWith('/api/remote/session/end');
    if (ending) this.ended.push({ url, init, clearedBefore: this.cleared });
    else this.fetched.push(url);
    if (!ending && !url.endsWith('/api/attention')) {
      return Promise.resolve(answered(this.sessionStatus, null));
    }
    const answer = ending ? this.end : this.attention;
    if (answer === 'unreachable') return Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED'));
    if (answer === 'silent') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted.')));
      });
    }
    return Promise.resolve(answered(answer.status, answer.body));
  }

  private beforeRequest: RequestHandler | null = null;
  private beforeHeaders: HeaderHandler | null = null;
  private permission: PermissionHandler | null = null;
  private check: (() => boolean) | null = null;
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

  setPermissionCheckHandler(handler: () => boolean): void {
    this.check = handler;
  }

  setDevicePermissionHandler(handler: () => boolean): void {
    this.device = handler;
  }

  clearStorageData(): Promise<void> {
    this.cleared += 1;
    return Promise.resolve();
  }

  requestCancelled(url: string, resourceType = 'xhr'): boolean {
    let cancelled = false;
    this.beforeRequest?.({ url, resourceType }, (answer) => {
      cancelled = answer.cancel === true;
    });
    return cancelled;
  }

  headersSent(requestHeaders: Record<string, string>): Record<string, string> {
    let sent = requestHeaders;
    this.beforeHeaders?.({ requestHeaders }, (answer) => {
      sent = answer.requestHeaders;
    });
    return sent;
  }

  permissionAnswers(permission: string): { request: boolean; check: boolean; device: boolean } {
    let request = true;
    this.permission?.(null, permission, (answer) => {
      request = answer;
    });
    return { request, check: this.check?.() !== false, device: this.device?.() !== false };
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

export class FakeContents extends EventEmitter {
  readonly loaded: string[] = [];
  focused = 0;
  closed = false;
  private opener: ((details: { url: string }) => { action: string }) | null = null;

  loadURL(url: string): Promise<void> {
    this.loaded.push(url);
    return Promise.resolve();
  }

  focus(): void {
    this.focused += 1;
  }

  close(): void {
    this.closed = true;
  }

  isDestroyed(): boolean {
    return this.closed;
  }

  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
    this.opener = handler;
  }

  windowOpen(url: string): string {
    return this.opener?.({ url }).action ?? 'allow';
  }

  navigates(url: string): boolean {
    const event = prevention();
    this.emit('will-navigate', event, url);
    return !event.prevented;
  }

  redirects(url: string, isMainFrame = true): boolean {
    const event = prevention();
    this.emit('will-redirect', event, url, false, isMainFrame);
    return !event.prevented;
  }

  unloadBlocked(): boolean {
    const event = prevention();
    this.emit('will-prevent-unload', event);
    return !event.prevented;
  }
}

interface FakeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FakeViewOptions {
  webPreferences: Record<string, unknown> & { session: FakeSession };
}

export class FakeView {
  readonly webContents = new FakeContents();
  bounds: FakeBounds | null = null;

  constructor(readonly options: FakeViewOptions) {}

  setBounds(bounds: FakeBounds): void {
    this.bounds = bounds;
  }
}

export interface FakeWindowOptions {
  title: string;
  width: number;
  height: number;
}

export class FakeWindow extends EventEmitter {
  readonly views: FakeView[] = [];
  readonly contentView = { addChildView: (view: FakeView) => void this.views.push(view) };
  title: string;
  visible = true;
  destroyed = false;
  minimized = false;
  focused = 0;
  private size: [number, number];

  constructor(readonly options: FakeWindowOptions) {
    super();
    this.title = options.title;
    this.size = [options.width, options.height];
    desk.windows.push(this);
  }

  getContentSize(): number[] {
    return [...this.size];
  }

  resizeTo(width: number, height: number): void {
    this.size = [width, height];
    this.emit('resize');
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  restore(): void {
    this.minimized = false;
  }

  hide(): void {
    this.visible = false;
  }

  show(): void {
    this.visible = true;
    this.emit('show');
  }

  showInactive(): void {
    this.show();
  }

  focus(): void {
    this.focused += 1;
    this.emit('focus');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    this.emit('closed');
  }
}

export class FakePower extends EventEmitter {
  sleeps(): void {
    this.emit('suspend');
  }

  wakes(): void {
    this.emit('resume');
  }
}

const defaultSession = new FakeSession('');

export const desk = {
  windows: [] as FakeWindow[],
  sessions: new Map<string, FakeSession>(),
  reset(): void {
    desk.windows.length = 0;
    desk.sessions.clear();
  },
  open(): FakeWindow[] {
    return desk.windows.filter((window) => !window.destroyed);
  },
};

export const fakeElectron = {
  BaseWindow: FakeWindow,
  WebContentsView: FakeView,
  session: {
    defaultSession,
    fromPartition(partition: string): FakeSession {
      if (partition === '') return defaultSession;
      const found = desk.sessions.get(partition) ?? new FakeSession(partition);
      desk.sessions.set(partition, found);
      return found;
    },
  },
};
