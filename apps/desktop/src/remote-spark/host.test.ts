import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_DEVICE_COOKIE, REMOTE_SPARK_PARTITION_PREFIX } from '@spark-outpost/contracts';
import { createAppLockGate, type AppLockGate } from '../app-lock-gate.ts';
import type { WorkerBridge } from '../browser/bridge.ts';
import { desk, fakeElectron, type FakeWindow } from './electron.fixture.ts';
import { startRemoteSparkHost, type RemoteSparkHost } from './host.ts';

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

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const only = (): FakeWindow => {
  expect(desk.open()).toHaveLength(1);
  return desk.open()[0]!;
};
const lock = (locked: boolean) =>
  gate.publish({ locked, available: true, hideNotifications: true });

beforeEach(() => {
  desk.reset();
  gate = createAppLockGate();
  posted = [];
  external = [];
  logged = [];
  host = startRemoteSparkHost({
    blockedPorts: () => new Set([32682]),
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
    expect(window.webContents.loaded).toEqual([
      `https://${HOST}/#code=ABCD-1234&name=Desk%20Mac&kind=spark`,
    ]);
    expect(window.options.webPreferences.session.cookies.placed).toEqual([]);
  });

  it('places the saved cookie before loading the host and sends nothing back', async () => {
    bridge.receive({ ...open, cookie: 'saved-value' });
    const window = only();
    const { cookies } = window.options.webPreferences.session;
    expect(cookies.placed.map((cookie) => [cookie.url, cookie.name, cookie.value])).toEqual([
      [`https://${HOST}`, REMOTE_DEVICE_COOKIE, 'saved-value'],
    ]);
    expect(window.webContents.loaded).toEqual([]);
    await settle();
    expect(window.webContents.loaded).toEqual([`https://${HOST}/`]);
    expect(posted).toEqual([]);
  });

  it('opens the pairing entry when the saved cookie cannot be placed, logging no value', async () => {
    fakeElectron.session.fromPartition(`${REMOTE_SPARK_PARTITION_PREFIX}${ID}`).cookies.failing =
      true;
    bridge.receive({ ...open, cookie: 'saved-value' });
    await settle();
    expect(only().webContents.loaded).toEqual([`https://${HOST}/#name=Desk%20Mac&kind=spark`]);
    expect(logged.join('\n')).not.toContain('saved-value');
  });

  it('is sandboxed with no preload, on its own session, with a fixed title', async () => {
    bridge.receive(open);
    await settle();
    const window = only();
    const { session, ...preferences } = window.options.webPreferences;
    expect(preferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    });
    expect(session.partition).toBe(`${REMOTE_SPARK_PARTITION_PREFIX}${ID}`);
    expect(window.title).toBe(TITLE);
    window.pageTitle('Spark Outpost');
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
  });

  it('sends a link to another site to the default browser', async () => {
    bridge.receive(open);
    await settle();
    expect(only().webContents.navigates('https://example.com/docs')).toBe(false);
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
    const { cookies } = only().options.webPreferences.session;
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
    const { cookies } = only().options.webPreferences.session;
    cookies.hostSets(REMOTE_DEVICE_COOKIE, 'other.tail1234.ts.net', 'theirs');
    cookies.hostSets('theme', HOST, 'dark');
    cookies.hostSets(REMOTE_DEVICE_COOKIE, HOST, 'x'.repeat(513));
    expect(posted).toEqual([]);
  });

  it('stops reporting to a process that went away', async () => {
    bridge.receive(open);
    await settle();
    bridge.close();
    only().options.webPreferences.session.cookies.hostSets(REMOTE_DEVICE_COOKIE, HOST, 'first');
    expect(posted).toEqual([]);
  });
});

describe('closing a remote Spark window', () => {
  it('closes the window and clears its session on remote-spark:close, with no sign-out', async () => {
    bridge.receive({ ...open, cookie: 'saved-value' });
    await settle();
    const window = only();
    const target = window.options.webPreferences.session;
    bridge.receive({ kind: 'remote-spark:close', id: ID });
    await settle();
    expect(window.destroyed).toBe(true);
    expect(target.cleared).toBe(1);
    target.cookies.hostRemoves(REMOTE_DEVICE_COOKIE, HOST, 'saved-value');
    expect(posted).toEqual([]);
  });

  it('clears the session of a Spark whose window the user already closed', async () => {
    bridge.receive(open);
    await settle();
    const window = only();
    window.destroy();
    bridge.receive({ kind: 'remote-spark:close', id: ID });
    await settle();
    expect(window.options.webPreferences.session.cleared).toBe(1);
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
