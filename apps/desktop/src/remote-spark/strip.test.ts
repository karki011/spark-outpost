import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_SPARK_PARTITION_PREFIX } from '@spark-outpost/contracts';
import type { WorkerBridge } from '../browser/bridge.ts';
import {
  desk,
  fakeElectron,
  FakePower,
  type FakeSession,
  type FakeView,
  type FakeWindow,
} from './electron.fixture.ts';
import { startRemoteSparkHost } from './host.ts';
import { STRIP_HEIGHT, STRIP_PARTITION } from './strip.ts';

vi.mock('electron', async () => (await import('./electron.fixture.ts')).fakeElectron);

const ID = '11111111-2222-4333-8444-555555555555';
const HOST = 'studio.tail1234.ts.net';
const open = {
  kind: 'remote-spark:open',
  id: ID,
  name: 'Studio Mac',
  hostname: HOST,
  deviceName: 'Desk Mac',
  code: null,
  cookie: null,
};

let bridge: WorkerBridge;
let external: string[];

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const only = (): FakeWindow => {
  expect(desk.open()).toHaveLength(1);
  return desk.open()[0]!;
};
const isRemote = (view: FakeView) =>
  view.options.webPreferences.session.partition.startsWith(REMOTE_SPARK_PARTITION_PREFIX);
const remoteView = (window: FakeWindow) => window.views.find(isRemote)!;
const stripView = (window: FakeWindow) => window.views.find((view) => !isRemote(view))!;
const page = (window: FakeWindow) => remoteView(window).webContents;
const sessionOf = (window: FakeWindow): FakeSession =>
  remoteView(window).options.webPreferences.session;

beforeEach(() => {
  desk.reset();
  external = [];
  const host = startRemoteSparkHost({
    blockedPorts: () => new Set([32682]),
    power: new FakePower(),
    openExternal: (url) => external.push(url),
    log: () => undefined,
  });
  bridge = host.connect({ post: () => undefined });
});

describe('the strip that marks another Mac', () => {
  const stripHtml = (window: FakeWindow) =>
    decodeURIComponent(stripView(window).webContents.loaded.at(-1)!);

  it('is a local page on its own session, never the remote one or the app’s', async () => {
    bridge.receive({ ...open, cookie: 'saved-value' });
    await settle();
    const window = only();
    expect(window.views).toHaveLength(2);
    const strip = stripView(window);
    const { session, ...preferences } = strip.options.webPreferences;
    expect(session.partition).toBe(STRIP_PARTITION);
    expect(session).not.toBe(fakeElectron.session.defaultSession);
    expect(session).not.toBe(sessionOf(window));
    expect(preferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      javascript: false,
    });
    expect(strip.webContents.loaded).toHaveLength(1);
    expect(strip.webContents.loaded[0]).toMatch(/^data:text\/html/);
    expect(session.cookies.placed).toEqual([]);
    expect(session.fetched).toEqual([]);
    expect(page(window).loaded).toEqual([`https://${HOST}/`]);
  });

  it('names the Mac and its address, with no script', async () => {
    bridge.receive(open);
    await settle();
    const html = stripHtml(only());
    expect(html).toContain('<strong>Remote control</strong>');
    expect(html).toContain('<span>Studio Mac</span>');
    expect(html).toContain(`<span>${HOST}</span>`);
    expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'");
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).not.toMatch(/<script|javascript:|\son\w+=/i);
  });

  it('escapes the saved name', async () => {
    bridge.receive({ ...open, name: '<img src=x onerror="alert(1)"> & <script>' });
    await settle();
    const html = stripHtml(only());
    expect(html).toContain(
      '<span>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;script&gt;</span>',
    );
    expect(html).not.toMatch(/<script|<img/i);
  });

  it('goes nowhere and opens nothing, and its session loads only its own page', async () => {
    bridge.receive(open);
    await settle();
    const strip = stripView(only());
    expect(strip.webContents.navigates(`https://${HOST}/`)).toBe(false);
    expect(strip.webContents.windowOpen('https://example.com/')).toBe('deny');
    const { session } = strip.options.webPreferences;
    expect(session.requestCancelled(`https://${HOST}/`, 'mainFrame')).toBe(true);
    expect(session.requestCancelled('https://example.com/pixel.png', 'image')).toBe(true);
    expect(session.requestCancelled(strip.webContents.loaded[0]!, 'mainFrame')).toBe(false);
    expect(session.permissionAnswers('media')).toEqual({
      request: false,
      check: false,
      device: false,
    });
    expect(external).toEqual([]);
  });

  it('sits above the remote page and both follow the window’s size', async () => {
    bridge.receive(open);
    await settle();
    const window = only();
    expect(stripView(window).bounds).toEqual({ x: 0, y: 0, width: 1280, height: STRIP_HEIGHT });
    expect(remoteView(window).bounds).toEqual({
      x: 0,
      y: STRIP_HEIGHT,
      width: 1280,
      height: 860 - STRIP_HEIGHT,
    });
    window.resizeTo(900, 600);
    expect(stripView(window).bounds).toEqual({ x: 0, y: 0, width: 900, height: STRIP_HEIGHT });
    expect(remoteView(window).bounds).toEqual({
      x: 0,
      y: STRIP_HEIGHT,
      width: 900,
      height: 600 - STRIP_HEIGHT,
    });
    window.resizeTo(900, 10);
    expect(remoteView(window).bounds?.height).toBe(0);
  });

  it('closes both pages with the window', async () => {
    bridge.receive(open);
    await settle();
    const window = only();
    window.destroy();
    expect(window.views.map((view) => view.webContents.closed)).toEqual([true, true]);
  });

  it('leaves the keyboard with the remote page when the window is focused', async () => {
    bridge.receive(open);
    await settle();
    const window = only();
    window.focus();
    expect(page(window).focused).toBe(1);
    expect(stripView(window).webContents.focused).toBe(0);
  });
});
