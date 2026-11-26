import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_DEVICE_COOKIE, REMOTE_SPARK_PARTITION_PREFIX } from '@spark-outpost/contracts';
import { createAppLockGate, type AppLockGate } from '../app-lock-gate.ts';
import type { WorkerBridge } from '../browser/bridge.ts';
import {
  desk,
  fakeElectron,
  FakePower,
  type FakeSession,
  type FakeView,
  type FakeWindow,
} from './electron.fixture.ts';
import { REMOTE_SPARK_END_TIMEOUT_MS } from './end-session.ts';
import { startRemoteSparkHost, type RemoteSparkHost } from './host.ts';
import { isNotLoadedPage } from './load-state.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);

const ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '22222222-3333-4444-8555-666666666666';
const HOST = 'studio.tail1234.ts.net';
const TITLE = `Remote control · Studio Mac · ${HOST}`;
const open = {
  kind: 'remote-spark:open',
  id: ID,
  name: 'Studio Mac',
  hostname: HOST,
  deviceName: 'Desk Mac',
  code: null,
  cookie: null,
};

let gate: AppLockGate;
let host: RemoteSparkHost;
let bridge: WorkerBridge;
let posted: unknown[];
let external: string[];
let logged: string[];
let power: FakePower;

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const only = (): FakeWindow => {
  expect(desk.open()).toHaveLength(1);
  return desk.open()[0]!;
};
const viewOn = (window: FakeWindow, remote: boolean): FakeView => {
  const found = window.views.filter(
    (view) =>
      view.options.webPreferences.session.partition.startsWith(REMOTE_SPARK_PARTITION_PREFIX) ===
      remote,
  );
  expect(found).toHaveLength(1);
  return found[0]!;
};
const remoteView = (window: FakeWindow) => viewOn(window, true);
const page = (window: FakeWindow) => remoteView(window).webContents;
const sessionOf = (window: FakeWindow): FakeSession =>
  remoteView(window).options.webPreferences.session;
const lock = (locked: boolean) =>
  gate.publish({ locked, available: true, hideNotifications: true });

beforeEach(() => {
  desk.reset();
  gate = createAppLockGate();
  posted = [];
  external = [];
  logged = [];
  power = new FakePower();
  host = startRemoteSparkHost({
    blockedPorts: () => new Set([32682]),
    power,
    openExternal: (url) => external.push(url),
    log: (line) => logged.push(line),
    gate,
  });
  bridge = host.connect({ post: (message) => posted.push(message) });
});

describe('opening a remote Spark window', () => {
  it('loads the pairing entry with this Mac’s name and the code when there is no cookie', async () => {
    bridge.receive({ ...open, code: 'ABCD-1234' });
    await settle();
    const window = only();
    expect(page(window).loaded).toEqual([
      `https://${HOST}/#code=ABCD-1234&name=Desk%20Mac&kind=spark`,
    ]);
    expect(sessionOf(window).cookies.placed).toEqual([]);
  });

  it('places the saved cookie before loading the host and sends nothing back', async () => {
    bridge.receive({ ...open, cookie: 'saved-value' });
    const window = only();
    const { cookies } = sessionOf(window);
    expect(cookies.placed.map((cookie) => [cookie.url, cookie.name, cookie.value])).toEqual([
      [`https://${HOST}`, REMOTE_DEVICE_COOKIE, 'saved-value'],
    ]);
    expect(page(window).loaded).toEqual([]);
    await settle();
    expect(page(window).loaded).toEqual([`https://${HOST}/`]);
    expect(posted).toEqual([]);
  });

  it('opens the pairing entry when the saved cookie cannot be placed, logging no value', async () => {
    fakeElectron.session.fromPartition(`${REMOTE_SPARK_PARTITION_PREFIX}${ID}`).cookies.failing =
      true;
    bridge.receive({ ...open, cookie: 'saved-value' });
    await settle();
    expect(page(only()).loaded).toEqual([`https://${HOST}/#name=Desk%20Mac&kind=spark`]);
    expect(logged.join('\n')).not.toContain('saved-value');
  });

  it('is sandboxed with no preload, on its own session, with a fixed title', async () => {
    bridge.receive(open);
    await settle();
    const window = only();
    const { session, ...preferences } = remoteView(window).options.webPreferences;
    expect(preferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    });
    expect(session.partition).toBe(`${REMOTE_SPARK_PARTITION_PREFIX}${ID}`);
    expect(window.title).toBe(TITLE);
    page(window).emit('page-title-updated', {}, 'Spark Outpost', true);
    expect(window.title).toBe(TITLE);
  });

  it('focuses the window it already has for that Spark', async () => {
    bridge.receive(open);
    await settle();
    const window = only();
    window.minimized = true;
    bridge.receive(open);
    await settle();
    expect(desk.windows).toHaveLength(1);
    expect(window.minimized).toBe(false);
    expect(window.focused).toBe(1);
    expect(page(window).focused).toBe(1);
  });

  it('sends a link to another site to the default browser', async () => {
    bridge.receive(open);
    await settle();
    expect(page(only()).navigates('https://example.com/docs')).toBe(false);
    expect(external).toEqual(['https://example.com/docs']);
  });
});

describe('the bridge to the API process', () => {
  it('ignores malformed messages', async () => {
    for (const raw of [
      null,
      'remote-spark:open',
      { kind: 'remote-spark:open' },
      { ...open, id: 'not-a-uuid' },
      { ...open, hostname: 'https://studio.tail1234.ts.net/' },
      { ...open, cookie: '' },
      { ...open, kind: 'browser:request' },
      { kind: 'remote-spark:close' },
    ]) {
      bridge.receive(raw);
    }
    await settle();
    expect(desk.windows).toEqual([]);
    expect(posted).toEqual([]);
  });

  it('reports a cookie the host sets, a replaced one, and a sign-out', async () => {
    bridge.receive(open);
    await settle();
    const { cookies } = sessionOf(only());
    cookies.hostSets(REMOTE_DEVICE_COOKIE, HOST, 'first');
    cookies.hostReplaces(REMOTE_DEVICE_COOKIE, HOST, 'first', 'second');
    cookies.hostRemoves(REMOTE_DEVICE_COOKIE, HOST, 'second');
    expect(posted).toEqual([
      { kind: 'remote-spark:cookie', id: ID, hostname: HOST, value: 'first' },
      { kind: 'remote-spark:cookie', id: ID, hostname: HOST, value: 'second' },
      { kind: 'remote-spark:signed-out', id: ID },
    ]);
  });

  it('reports nothing for another host or cookie name, or a value too long to save', async () => {
    bridge.receive(open);
    await settle();
    const { cookies } = sessionOf(only());
    cookies.hostSets(REMOTE_DEVICE_COOKIE, 'other.tail1234.ts.net', 'theirs');
    cookies.hostSets('theme', HOST, 'dark');
    cookies.hostSets(REMOTE_DEVICE_COOKIE, HOST, 'x'.repeat(513));
    expect(posted).toEqual([]);
  });

  it('stops reporting to a process that went away', async () => {
    bridge.receive(open);
    await settle();
    bridge.close();
    sessionOf(only()).cookies.hostSets(REMOTE_DEVICE_COOKIE, HOST, 'first');
    expect(posted).toEqual([]);
  });
});

describe('closing a remote Spark window', () => {
  it('closes the window and clears its session on remote-spark:close, with no sign-out', async () => {
    bridge.receive({ ...open, cookie: 'saved-value' });
    await settle();
    const window = only();
    const target = sessionOf(window);
    bridge.receive({ kind: 'remote-spark:close', id: ID });
    await settle();
    expect(window.destroyed).toBe(true);
    expect(target.cleared).toBe(1);
    target.cookies.hostRemoves(REMOTE_DEVICE_COOKIE, HOST, 'saved-value');
    expect(posted).toEqual([]);
  });

  it('asks the other Mac to end the session before clearing it', async () => {
    bridge.receive({ ...open, cookie: 'saved-value' });
    await settle();
    const window = only();
    const target = sessionOf(window);
    bridge.receive({ kind: 'remote-spark:close', id: ID });
    await settle();
    expect(target.ended).toHaveLength(1);
    const [{ url, init, clearedBefore }] = target.ended as [(typeof target.ended)[number]];
    expect(url).toBe(`https://${HOST}/api/remote/session/end`);
    expect(clearedBefore).toBe(0);
    expect({ ...init, signal: undefined }).toEqual({
      method: 'POST',
      credentials: 'include',
      headers: { Origin: `https://${HOST}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: undefined,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(window.destroyed).toBe(true);
    expect(target.cleared).toBe(1);
    expect(posted).toEqual([]);
  });

  it('asks nothing of a Mac it holds no sign-in for', async () => {
    bridge.receive(open);
    await settle();
    const target = sessionOf(only());
    bridge.receive({ kind: 'remote-spark:close', id: ID });
    await settle();
    expect(target.ended).toEqual([]);
    expect(target.cleared).toBe(1);
  });

  it('ends the session of a Spark it only watched', async () => {
    bridge.receive({
      kind: 'remote-spark:watch',
      sparks: [{ id: ID, hostname: HOST, cookie: 'saved-value' }],
    });
    await settle();
    const target = fakeElectron.session.fromPartition(`${REMOTE_SPARK_PARTITION_PREFIX}${ID}`);
    bridge.receive({ kind: 'remote-spark:close', id: ID });
    await settle();
    expect(target.ended.map((request) => request.url)).toEqual([
      `https://${HOST}/api/remote/session/end`,
    ]);
    expect(target.cleared).toBe(1);
    host.dispose();
  });

  it('clears the session when the other Mac refuses or cannot be reached, once', async () => {
    for (const [id, end] of [
      [ID, 'unreachable'],
      [OTHER_ID, { status: 403, body: null }],
    ] as const) {
      bridge.receive({ ...open, id, cookie: 'saved-value' });
      await settle();
      const target = fakeElectron.session.fromPartition(`${REMOTE_SPARK_PARTITION_PREFIX}${id}`);
      target.end = end;
      bridge.receive({ kind: 'remote-spark:close', id });
      await settle();
      expect(target.ended).toHaveLength(1);
      expect(target.cleared).toBe(1);
    }
    expect(desk.open()).toEqual([]);
    expect(logged.join('\n')).not.toContain('saved-value');
  });

  it('gives up on an end request that gets no answer and clears the session', async () => {
    vi.useFakeTimers();
    try {
      bridge.receive({ ...open, cookie: 'saved-value' });
      await vi.advanceTimersByTimeAsync(0);
      const window = only();
      const target = sessionOf(window);
      target.end = 'silent';
      bridge.receive({ kind: 'remote-spark:close', id: ID });
      await vi.advanceTimersByTimeAsync(REMOTE_SPARK_END_TIMEOUT_MS - 1);
      expect(window.destroyed).toBe(true);
      expect(target.cleared).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(target.ended).toHaveLength(1);
      expect(target.cleared).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the session of a Spark whose window the user already closed', async () => {
    bridge.receive(open);
    await settle();
    const window = only();
    window.destroy();
    bridge.receive({ kind: 'remote-spark:close', id: ID });
    await settle();
    expect(sessionOf(window).cleared).toBe(1);
  });

  it('opens a new window after the user closed the old one', async () => {
    bridge.receive(open);
    await settle();
    only().destroy();
    bridge.receive(open);
    await settle();
    expect(desk.windows).toHaveLength(2);
    expect(desk.open()).toHaveLength(1);
  });

  it('closes every window when the app quits', async () => {
    bridge.receive(open);
    bridge.receive({ ...open, id: OTHER_ID, hostname: 'laptop.tail1234.ts.net' });
    await settle();
    expect(desk.open()).toHaveLength(2);
    host.dispose();
    expect(desk.open()).toEqual([]);
  });
});

describe('a remote Spark window and the privacy screen', () => {
  it('is hidden while Spark is locked and shown again on unlock', async () => {
    bridge.receive(open);
    await settle();
    const window = only();
    lock(true);
    expect(window.visible).toBe(false);
    lock(false);
    expect(window.visible).toBe(true);
  });

  it('opens hidden while locked and stays hidden when asked to focus', async () => {
    lock(true);
    bridge.receive(open);
    await settle();
    const window = only();
    expect(window.visible).toBe(false);
    bridge.receive(open);
    expect(window.visible).toBe(false);
    lock(false);
    expect(window.visible).toBe(true);
  });
});

describe('a remote Spark that does not answer or no longer knows this Mac', () => {
  const entry = `https://${HOST}/`;

  it('shows the did-not-load page when the address cannot be reached, once', async () => {
    bridge.receive({ ...open, cookie: 'saved' });
    await settle();
    const window = only();
    page(window).emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', entry, true);
    await settle();
    const shown = page(window).loaded.at(-1)!;
    expect(isNotLoadedPage(shown)).toBe(true);
    expect(decodeURIComponent(shown)).toContain(`<a href="${entry}" autofocus>Try again</a>`);

    const before = page(window).loaded.length;
    page(window).emit('did-fail-load', {}, -3, 'ABORTED', entry, true);
    page(window).emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', entry, false);
    page(window).emit('did-fail-load', {}, -300, 'INVALID_URL', shown, true);
    await settle();
    expect(page(window).loaded).toHaveLength(before);
  });

  it('shows the did-not-load page for a gateway error', async () => {
    bridge.receive(open);
    await settle();
    const window = only();
    page(window).emit('did-navigate', {}, entry, 502);
    await settle();
    expect(isNotLoadedPage(page(window).loaded.at(-1)!)).toBe(true);
  });

  it('forgets a sign-in the other Mac refuses and goes back to pairing', async () => {
    bridge.receive({ ...open, cookie: 'saved' });
    await settle();
    const window = only();
    const session = sessionOf(window);
    session.sessionStatus = 401;
    posted.length = 0;
    page(window).emit('did-navigate', {}, entry, 200);
    await settle();
    expect(session.fetched).toEqual([`https://${HOST}/api/remote/session`]);
    expect(posted).toEqual([{ kind: 'remote-spark:signed-out', id: ID }]);
    expect(session.cookies.removed).toEqual([`https://${HOST} ${REMOTE_DEVICE_COOKIE}`]);
    expect(page(window).loaded.at(-1)).toBe(`https://${HOST}/#name=Desk%20Mac&kind=spark`);

    page(window).emit('did-navigate', {}, entry, 200);
    await settle();
    expect(session.fetched).toHaveLength(1);
  });

  it('keeps a sign-in the other Mac accepts and asks nothing without one', async () => {
    bridge.receive({ ...open, cookie: 'saved' });
    await settle();
    const signedIn = only();
    posted.length = 0;
    page(signedIn).emit('did-navigate', {}, entry, 200);
    await settle();
    expect(posted).toEqual([]);
    expect(sessionOf(signedIn).cookies.removed).toEqual([]);

    bridge.receive({ ...open, id: OTHER_ID });
    await settle();
    const unsigned = desk.open().find((window) => window !== signedIn)!;
    page(unsigned).emit('did-navigate', {}, entry, 200);
    await settle();
    expect(sessionOf(unsigned).fetched).toEqual([]);
  });
});
