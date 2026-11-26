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
    const entry = (await signedIn())
      ? `${remoteSparkOrigin(hostname)}/`
      : sparkPairingEntry(hostname, spark.deviceName, spark.code);
    if (window.isDestroyed()) return;
    await window.loadURL(entry).catch(() => undefined);
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
