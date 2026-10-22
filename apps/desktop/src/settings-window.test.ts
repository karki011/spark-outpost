import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from './ipc-channels.ts';
import { isDocLink, settingsTarget, startSettingsWindow } from './settings-window.ts';

const native = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown, ...values: unknown[]) => void>();
  const handlers = new Map<string, (event: unknown) => unknown>();
  let nextId = 40;
  class Window {
    id = (nextId += 1);
    destroyed = false;
    minimized = false;
    events = new Map<string, () => void>();
    webContents = { id: this.id, send: vi.fn() };
    loadURL = vi.fn(async () => undefined);
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn();
    destroy = vi.fn(() => {
      this.destroyed = true;
    });
    isDestroyed = () => this.destroyed;
    isMinimized = () => this.minimized;
    on = (name: string, listener: () => void) => this.events.set(name, listener);
    once = (name: string, listener: () => void) => this.events.set(name, listener);
  }
  const windows: Window[] = [];
  const options: unknown[] = [];
  return {
    listeners,
    handlers,
    windows,
    options,
    BrowserWindow: vi.fn(function (settings: unknown) {
      const window = new Window();
      windows.push(window);
      options.push(settings);
      return window;
    }),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: native.BrowserWindow,
  ipcMain: {
    on: (channel: string, listener: (event: unknown, ...values: unknown[]) => void) =>
      native.listeners.set(channel, listener),
    off: (channel: string) => native.listeners.delete(channel),
    handle: (channel: string, handler: (event: unknown) => unknown) =>
      native.handlers.set(channel, handler),
    removeHandler: (channel: string) => native.handlers.delete(channel),
  },
}));
vi.mock('./window.ts', () => ({ guardNavigation: vi.fn() }));
vi.mock('./context-menu.ts', () => ({ attachContextMenu: vi.fn() }));
vi.mock('./hour-cycle.ts', () => ({ systemHourCycle: () => null }));

const ORIGIN = 'http://127.0.0.1:4000';

function start(change: { trusted?: boolean } = {}) {
  const mainSend = vi.fn();
  const did: string[] = [];
  const host = startSettingsWindow({
    origin: ORIGIN,
    preload: '/preload.cjs',
    theme: () => 'graphite',
    trusted: () => change.trusted ?? true,
    mainWindow: () => ({ isDestroyed: () => false, webContents: { send: mainSend } }) as never,
    showSpark: () => did.push('show spark'),
    openChat: (id) => did.push(`open chat ${id}`),
  });
  return { host, mainSend, did };
}

const fromWindow = (index = 0) => ({ sender: { id: native.windows[index]!.webContents.id } });
const fromElsewhere = { sender: { id: 1 } };

afterEach(() => {
  native.windows.length = 0;
  native.options.length = 0;
  native.listeners.clear();
  native.handlers.clear();
});

describe('settingsTarget', () => {
  it('accepts a settings section route, with a provider below it', () => {
    expect(settingsTarget('#/settings/notifications', null)).toEqual({
      route: '#/settings/notifications',
      focus: null,
    });
    expect(settingsTarget('#/settings/providers/claude', 'Model')).toEqual({
      route: '#/settings/providers/claude',
      focus: 'Model',
    });
  });

  it('refuses anything that is not a settings route', () => {
    for (const route of ['#/docs/settings', 'https://example.com', '#/settings/', 42, null]) {
      expect(settingsTarget(route, null)).toBeNull();
    }
    expect(settingsTarget('#/settings/chats', 'x'.repeat(201))?.focus).toBeNull();
  });
});

describe('isDocLink', () => {
  it('accepts only guide links', () => {
    expect(isDocLink('#/docs/settings#general')).toBe(true);
    expect(isDocLink('#/docs')).toBe(true);
    expect(isDocLink('javascript:alert(1)')).toBe(false);
    expect(isDocLink('#/settings/chats')).toBe(false);
  });
});

describe('the Settings window', () => {
  it('opens one window on the section, loading the app at /settings', () => {
    const { host } = start();
    host.open({ route: '#/settings/chats', focus: null });
    expect(native.windows).toHaveLength(1);
    expect(native.windows[0]!.loadURL).toHaveBeenCalledWith(`${ORIGIN}/settings#/settings/chats`);
    expect(native.options[0]).toMatchObject({
      title: 'Settings',
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
  });

  it('brings the open window forward and hands it the new section instead of opening another', () => {
    const { host } = start();
    host.open({ route: '#/settings/chats', focus: null });
    const window = native.windows[0]!;
    window.minimized = true;
    host.open({ route: '#/settings/help', focus: 'Send feedback' });
    expect(native.windows).toHaveLength(1);
    expect(window.restore).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledWith(IPC.settingsWindowChanged);
    const take = native.handlers.get(IPC.settingsWindowTake)!;
    expect(take(fromElsewhere)).toBeNull();
    expect(take(fromWindow())).toEqual({ route: '#/settings/help', focus: 'Send feedback' });
    expect(take(fromWindow())).toBeNull();
  });

  it('shows the open window as it is, or opens on General', () => {
    const { host } = start();
    host.show();
    expect(native.windows[0]!.loadURL).toHaveBeenCalledWith(`${ORIGIN}/settings#/settings/spark`);
    host.show();
    expect(native.windows).toHaveLength(1);
    expect(native.windows[0]!.webContents.send).not.toHaveBeenCalled();
  });

  it('opens a new window after the old one closed', () => {
    const { host } = start();
    host.open({ route: '#/settings/chats', focus: null });
    native.windows[0]!.destroyed = true;
    native.windows[0]!.events.get('closed')!();
    host.open({ route: '#/settings/chats', focus: null });
    expect(native.windows).toHaveLength(2);
  });

  it('opens from the main window only with a valid route from a trusted page', () => {
    start({ trusted: false });
    native.listeners.get(IPC.settingsWindowOpen)!(fromElsewhere, '#/settings/chats', null);
    expect(native.windows).toHaveLength(0);
    start();
    native.listeners.get(IPC.settingsWindowOpen)!(fromElsewhere, '#/elsewhere', null);
    expect(native.windows).toHaveLength(0);
    native.listeners.get(IPC.settingsWindowOpen)!(fromElsewhere, '#/settings/chats', null);
    expect(native.windows).toHaveLength(1);
  });

  it('opens chats and guide pages in the main window only for the Settings window', () => {
    const { host, mainSend, did } = start();
    host.open({ route: '#/settings/chats', focus: null });
    const openChat = native.listeners.get(IPC.settingsWindowOpenChat)!;
    const openDoc = native.listeners.get(IPC.settingsWindowOpenDoc)!;
    openChat(fromElsewhere, 'chat-1');
    openDoc(fromElsewhere, '#/docs/settings');
    openDoc(fromWindow(), 'https://example.com');
    expect(did).toEqual([]);
    openChat(fromWindow(), 'chat-1');
    openDoc(fromWindow(), '#/docs/settings');
    expect(did).toEqual(['open chat chat-1', 'show spark']);
    expect(mainSend).toHaveBeenCalledWith(IPC.settingsWindowDoc, '#/docs/settings');
  });

  it('closes the window and stops listening on dispose', () => {
    const { host } = start();
    host.open({ route: '#/settings/chats', focus: null });
    host.dispose();
    expect(native.windows[0]!.destroy).toHaveBeenCalled();
    expect(native.listeners.size).toBe(0);
    expect(native.handlers.size).toBe(0);
  });
});
