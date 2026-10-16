import { BrowserWindow, session, shell } from 'electron';
import { targetsApi, withApiToken } from './api-token.ts';
import type { ChannelConfig } from './channel.ts';
import { linkTarget } from './link-target.ts';
import { guardSessionMedia } from './media-guard.ts';
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

function openLink(url: string, origin: string): void {
  const target = linkTarget(url, origin);
  if (target === 'viewer') openViewer(url, origin);
  if (target === 'browser') void shell.openExternal(url);
}

export function attachApiToken(origin: string, token: string): void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: withApiToken(details.requestHeaders, details.url, origin, token) });
  });
}

export function guardNavigation(window: BrowserWindow, origin: string): void {
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
      additionalArguments: themeArgs(theme),
    },
  });
  window.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle(title);
  });
  return window;
}
