import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Contracts from '@spark-outpost/contracts';
import { IPC } from './ipc-channels.ts';
import { startMeetingAlertHost } from './meeting-alert-host.ts';

const native = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown, value?: unknown) => void>();
  class Window {
    visible = false;
    webContents = { id: 7, send: vi.fn(), focus: vi.fn() };
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    setContentProtection = vi.fn();
    setFocusable = vi.fn();
    setBounds = vi.fn();
    focus = vi.fn();
    loadURL = vi.fn(async () => undefined);
    showInactive = vi.fn(() => {
      this.visible = true;
    });
    isVisible = () => this.visible;
    isDestroyed = () => false;
    getBounds = () => ({ x: 0, y: 0, width: 1440, height: 900 });
    destroy = vi.fn();
  }
  const windows: Window[] = [];
  return {
    listeners,
    windows,
    BrowserWindow: vi.fn(function () {
      const window = new Window();
      windows.push(window);
      return window;
    }),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: native.BrowserWindow,
  ipcMain: {
    on: (channel: string, listener: (event: unknown, value?: unknown) => void) =>
      native.listeners.set(channel, listener),
    handle: vi.fn(),
    removeAllListeners: (channel: string) => native.listeners.delete(channel),
    removeHandler: vi.fn(),
  },
  powerMonitor: { on: vi.fn(), off: vi.fn(), getSystemIdleTime: () => 0 },
  systemPreferences: { getUserDefault: () => false },
  screen: {
    getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    getDisplayNearestPoint: () => ({
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 24, width: 1440, height: 876 },
    }),
  },
}));
vi.mock('./window.ts', () => ({ guardNavigation: vi.fn() }));
vi.mock('@spark-outpost/contracts', async (original) => ({
  ...(await original<typeof Contracts>()),
  meetingAlertPayloadSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
}));

const payload = { key: 'standup', events: [], calendars: {}, countdown: null };

afterEach(() => {
  native.listeners.clear();
  native.windows.length = 0;
});

describe('meeting alert overlay', () => {
  it('keeps the overlay from bringing Spark forward when it is clicked', () => {
    const preventActivation = vi.fn();
    const host = startMeetingAlertHost({
      origin: 'http://127.0.0.1:3000',
      preload: '/app/preload.cjs',
      trusted: () => true,
      fromIsland: () => true,
      islandCenter: () => null,
      sendToIsland: vi.fn(),
      hideInShare: () => false,
      preventActivation,
      log: vi.fn(),
    });
    native.listeners.get(IPC.meetingAlertShow)?.({}, payload);
    expect(native.windows).toHaveLength(1);
    expect(preventActivation).toHaveBeenCalledWith(native.windows[0]);
    host.dispose();
  });
});
