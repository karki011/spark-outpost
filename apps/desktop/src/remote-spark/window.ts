import { BrowserWindow } from 'electron';
import {
  remoteSparkOrigin,
  remoteSparkWindowTitle,
  sparkPairingEntry,
  type RemoteSparkBridgeToHost,
} from '@spark-outpost/contracts';
import type { AppLockGate } from '../app-lock-gate.ts';
import { hideWhileLocked } from '../app-lock-windows.ts';
import { watchDeviceCookie, type CookieJar, type DeviceCookieEvents } from './cookie.ts';
import { answerFailed, isNotLoadedPage, loadFailed, notLoadedPage } from './load-state.ts';
import { guardRemoteNavigation } from './navigation.ts';
import { remoteSparkSession, type RemoteSparkGuards } from './partition.ts';

export type RemoteSparkOpen = Extract<RemoteSparkBridgeToHost, { kind: 'remote-spark:open' }>;

export interface RemoteSparkWindowHooks extends DeviceCookieEvents {
  guards: RemoteSparkGuards;
  gate: AppLockGate | undefined;
  openExternal(url: string): void;
  closed(): void;
}

export interface RemoteSparkWindow {
  focus(): void;
  close(): void;
}

const WINDOW_SIZE = { width: 1280, height: 860, minWidth: 720, minHeight: 520 } as const;

export function openRemoteSparkWindow(
  spark: RemoteSparkOpen,
  hooks: RemoteSparkWindowHooks,
): RemoteSparkWindow {
  const { hostname } = spark;
  const target = remoteSparkSession(spark.id, hostname, hooks.guards);
  const title = remoteSparkWindowTitle(spark.name, hostname);
  const window = new BrowserWindow({
    ...WINDOW_SIZE,
    title,
    autoHideMenuBar: true,
    webPreferences: {
      session: target,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  window.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle(title);
  });
  guardRemoteNavigation(window.webContents, hostname, hooks.openExternal);
  hideWhileLocked(window, hooks.gate);
  const watch = watchDeviceCookie(target.cookies as CookieJar, hostname, hooks);
  window.on('closed', () => {
    watch.stop();
    hooks.closed();
  });

  const origin = remoteSparkOrigin(hostname);
  const pairingEntry = (code: string | null) => sparkPairingEntry(hostname, spark.deviceName, code);
  let entry = `${origin}/`;
  const load = async (url: string) => {
    if (window.isDestroyed()) return;
    await window.loadURL(url).catch(() => undefined);
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
  window.webContents.on('did-fail-load', (_event, code, _text, url, isMainFrame) => {
    if (isMainFrame && loadFailed(code) && !isNotLoadedPage(url)) showNotLoaded();
  });
  window.webContents.on('did-navigate', (_event, url, httpCode) => {
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
      if (!window.isDestroyed()) window.destroy();
    },
  };
}
