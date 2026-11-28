import { BaseWindow, WebContentsView } from 'electron';
import {
  remoteSparkOrigin,
  remoteSparkWindowTitle,
  sparkPairingEntry,
  type RemoteSparkBridgeToHost,
} from '@spark-outpost/contracts';
import type { AppLockGate } from '../app-lock-gate.ts';
import { hideWhileLocked } from '../app-lock-windows.ts';
import {
  watchAccessCookie,
  watchDeviceCookie,
  type CookieJar,
  type DeviceCookieEvents,
} from './cookie.ts';
import { answerFailed, isNotLoadedPage, loadFailed, notLoadedPage } from './load-state.ts';
import { guardRemoteNavigation } from './navigation.ts';
import { remoteSparkSession, type RemoteSparkGuards } from './partition.ts';
import { stripLayout, stripPage, stripSession } from './strip.ts';

export type RemoteSparkOpen = Extract<RemoteSparkBridgeToHost, { kind: 'remote-spark:open' }>;

export interface RemoteSparkWindowHooks extends DeviceCookieEvents {
  guards: RemoteSparkGuards;
  gate: AppLockGate | undefined;
  accessChanged(value: string | null): void;
  openExternal(url: string): void;
  closed(): void;
}

export interface RemoteSparkWindow {
  focus(): void;
  close(): void;
}

const WINDOW_SIZE = { width: 1280, height: 860, minWidth: 720, minHeight: 520 } as const;
const GUARDED = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  devTools: false,
} as const;

export function openRemoteSparkWindow(
  spark: RemoteSparkOpen,
  hooks: RemoteSparkWindowHooks,
): RemoteSparkWindow {
  const { hostname } = spark;
  const target = remoteSparkSession(spark.id, hostname, hooks.guards);
  const title = remoteSparkWindowTitle(spark.name, hostname);
  const window = new BaseWindow({ ...WINDOW_SIZE, title, autoHideMenuBar: true });
  const strip = new WebContentsView({
    webPreferences: { ...GUARDED, session: stripSession(), javascript: false },
  });
  const remote = new WebContentsView({ webPreferences: { ...GUARDED, session: target } });
  const views = [strip, remote];
  const layOut = () => {
    const [width = 0, height = 0] = window.getContentSize();
    const bounds = stripLayout(width, height);
    strip.setBounds(bounds.strip);
    remote.setBounds(bounds.remote);
  };
  for (const view of views) window.contentView.addChildView(view);
  layOut();
  window.on('resize', layOut);
  window.on('focus', () => {
    if (!remote.webContents.isDestroyed()) remote.webContents.focus();
  });
  strip.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  strip.webContents.on('will-navigate', (event) => event.preventDefault());
  void strip.webContents.loadURL(stripPage(spark.name, hostname)).catch(() => undefined);
  guardRemoteNavigation(remote.webContents, hostname, hooks.openExternal);
  hideWhileLocked(window, hooks.gate);
  const watch = watchDeviceCookie(target.cookies as CookieJar, hostname, hooks);
  const access = watchAccessCookie(target.cookies as CookieJar, hostname, hooks.accessChanged);
  window.on('closed', () => {
    watch.stop();
    access.stop();
    for (const view of views) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    hooks.closed();
  });

  const origin = remoteSparkOrigin(hostname);
  const pairingEntry = (code: string | null) => sparkPairingEntry(hostname, spark.deviceName, code);
  let entry = `${origin}/`;
  const load = async (url: string) => {
    if (window.isDestroyed() || remote.webContents.isDestroyed()) return;
    await remote.webContents.loadURL(url).catch(() => undefined);
  };
  const showNotLoaded = () => void load(notLoadedPage(spark.name, hostname, entry));
  const checkSignIn = async () => {
    if (!watch.holds()) return;
    const status = await target
      .fetch(`${origin}/api/remote/session`, { credentials: 'include' })
      .then((response) => response.status)
      .catch(() => null);
    if (status !== 401 || !watch.holds()) return;
    await watch.forget().catch(() => undefined);
    entry = pairingEntry(null);
    await load(entry);
  };
  remote.webContents.on('did-fail-load', (_event, code, _text, url, isMainFrame) => {
    if (isMainFrame && loadFailed(code) && !isNotLoadedPage(url)) showNotLoaded();
  });
  remote.webContents.on('did-navigate', (_event, url, httpCode) => {
    if (!url.startsWith(`${origin}/`)) return;
    if (answerFailed(httpCode)) showNotLoaded();
    else void checkSignIn();
  });

  const signedIn = async (): Promise<boolean> => {
    if (spark.cookie === null) return false;
    try {
      await watch.place(spark.cookie);
      return true;
    } catch {
      hooks.guards.log('Could not use the saved sign-in for a remote Spark window.');
      return false;
    }
  };
  const start = async () => {
    if (spark.access !== null) await access.place(spark.access).catch(() => undefined);
    if (!(await signedIn())) entry = pairingEntry(spark.code);
    await load(entry);
  };
  void start();

  return {
    focus() {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
    close() {
      watch.stop();
      access.stop();
      if (!window.isDestroyed()) window.destroy();
    },
  };
}
