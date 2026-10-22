import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Contracts from '@spark-outpost/contracts';
import { IPC } from './ipc-channels.ts';
import { FOCUS_CARD_SHORTCUT, startMeetingAlertHost } from './meeting-alert-host.ts';

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

const payload = {
  key: 'standup',
  events: [],
  calendars: {},
  countdown: null,
  notice: { title: 'Standup', body: '10:00–10:15 · Zoom' },
};

afterEach(() => {
  native.listeners.clear();
  native.windows.length = 0;
});

function startHost(assistive = false) {
  const preventActivation = vi.fn();
  const sendToIsland = vi.fn();
  const registered = new Map<string, () => void>();
  const notifier = { post: vi.fn(), close: vi.fn() };
  const host = startMeetingAlertHost({
    origin: 'http://127.0.0.1:3000',
    preload: '/app/preload.cjs',
    trusted: () => true,
    fromIsland: () => true,
    islandCenter: () => null,
    sendToIsland,
    hideInShare: () => false,
    preventActivation,
    assistive: async () => assistive,
    register: (accelerator, run) => {
      registered.set(accelerator, run);
      return true;
    },
    unregister: (accelerator) => registered.delete(accelerator),
    notifier,
    log: vi.fn(),
  });
  const show = () => native.listeners.get(IPC.meetingAlertShow)?.({}, payload);
  const hide = () => native.listeners.get(IPC.meetingAlertHide)?.({});
  return { host, preventActivation, sendToIsland, registered, notifier, show, hide };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function sentTakeFocus(window: (typeof native.windows)[number]): boolean {
  return window.webContents.send.mock.calls.some(
    ([channel]) => channel === IPC.meetingAlertTakeFocus,
  );
}

describe('meeting alert overlay', () => {
  it('keeps the overlay from bringing Spark forward when it is clicked', () => {
    const { host, preventActivation, show } = startHost();
    show();
    expect(native.windows).toHaveLength(1);
    expect(preventActivation).toHaveBeenCalledWith(native.windows[0]);
    host.dispose();
  });

  it('stays unfocused for mouse users', async () => {
    const { host, show } = startHost(false);
    show();
    await settle();
    const [window] = native.windows;
    expect(window!.showInactive).toHaveBeenCalled();
    expect(window!.focus).not.toHaveBeenCalled();
    expect(sentTakeFocus(window!)).toBe(false);
    host.dispose();
  });

  it('takes focus when VoiceOver or Full Keyboard Access is on', async () => {
    const { host, show } = startHost(true);
    show();
    await settle();
    const [window] = native.windows;
    expect(window!.setFocusable).toHaveBeenCalledWith(true);
    expect(window!.focus).toHaveBeenCalled();
    expect(window!.webContents.focus).toHaveBeenCalled();
    expect(sentTakeFocus(window!)).toBe(true);
    window!.webContents.send.mockClear();
    native.listeners.get(IPC.meetingAlertReady)?.({ sender: { id: 7 } });
    expect(sentTakeFocus(window!)).toBe(true);
    host.dispose();
  });

  it('holds ⌃⌥⌘M only while the card shows, and it focuses the card', async () => {
    const { host, registered, show, hide } = startHost(false);
    show();
    const run = registered.get(FOCUS_CARD_SHORTCUT);
    expect(run).toBeDefined();
    run!();
    expect(sentTakeFocus(native.windows[0]!)).toBe(true);
    hide();
    expect(registered.has(FOCUS_CARD_SHORTCUT)).toBe(false);
    host.dispose();
  });

  it('mirrors the card as one notification and routes its buttons', () => {
    const { host, notifier, sendToIsland, show, hide } = startHost(false);
    show();
    show();
    expect(notifier.post).toHaveBeenCalledWith(payload, expect.any(Function));
    const choose = notifier.post.mock.calls[0]![1] as (choice: unknown) => void;
    choose({ kind: 'join', eventKey: 'standup-1' });
    expect(sendToIsland).toHaveBeenCalledWith(IPC.meetingAlertAction, {
      kind: 'join',
      key: 'standup',
      eventKey: 'standup-1',
    });
    choose({ kind: 'snooze' });
    expect(sendToIsland).toHaveBeenLastCalledWith(IPC.meetingAlertAction, {
      kind: 'snooze',
      key: 'standup',
      eventKey: null,
    });
    choose({ kind: 'show' });
    expect(sentTakeFocus(native.windows[0]!)).toBe(true);
    hide();
    expect(notifier.close).toHaveBeenCalled();
    host.dispose();
  });
});
