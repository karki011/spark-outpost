import { appendFileSync } from 'node:fs';
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { targetsApi, withApiToken } from './api-token.ts';
import type { ChannelConfig } from './channel.ts';
import { attachContextMenu } from './context-menu.ts';
import { linkTarget } from './link-target.ts';
import { guardSessionMedia } from './media-guard.ts';
import { allowArtifactFrames, fromArtifactPage, guardSubframes } from './artifact-frames.ts';
import { hourCycleArgs } from './hour-cycle-arg.ts';
import { systemHourCycle } from './hour-cycle.ts';
import { themeArgs } from './theme-arg.ts';

export interface WindowOptions {
  config: ChannelConfig;
  preload: string;
  theme: string | null;
}

const VIEWER_SIZE = { width: 960, height: 760 } as const;

function openViewer(url: string, origin: string): void {
  const viewer = new BrowserWindow({
    ...VIEWER_SIZE,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  guardNavigation(viewer, origin);
  void viewer.loadURL(url);
}

function openExternal(url: string): void {
  const fake = app.isPackaged ? undefined : process.env.SPARK_FAKE_OPEN_EXTERNAL;
  if (fake) appendFileSync(fake, `${new URL(url).host}\n`, { mode: 0o600 });
  else void shell.openExternal(url);
}

function openLink(url: string, origin: string): void {
  const target = linkTarget(url, origin);
  if (target === 'viewer') openViewer(url, origin);
  if (target === 'browser') openExternal(url);
}

export function attachApiToken(origin: string, token: string): void {
  allowArtifactFrames(Number(new URL(origin).port));
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const target = fromArtifactPage(details.frame?.url) ? '' : details.url;
    callback({ requestHeaders: withApiToken(details.requestHeaders, target, origin, token) });
  });
}

async function confirmArtifactLink(window: BrowserWindow, address: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    message: 'Open this link in your browser?',
    detail: `An artifact asked to open:\n${address}`,
    buttons: ['Open in Browser', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  return response === 0;
}

export function guardNavigation(window: BrowserWindow, origin: string): void {
  guardSubframes(window.webContents, {
    confirm: (address) => confirmArtifactLink(window, address),
    open: openExternal,
    now: Date.now,
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url, origin);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (targetsApi(url, origin)) return;
    event.preventDefault();
    openLink(url, origin);
  });
}

export function openWindow({ config, preload, theme }: WindowOptions): BrowserWindow {
  guardSessionMedia(session.defaultSession);
  const title = config.badge ? `${config.appName} — ${config.badge}` : config.appName;
  const window = new BrowserWindow({
    title,
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [...themeArgs(theme), ...hourCycleArgs(systemHourCycle())],
    },
  });
  window.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle(title);
  });
  attachContextMenu(window);
  return window;
}
