import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IslandPosition } from './companion-settings.ts';
import { dockedPosition, ISLAND_WIDTH, type DisplayInfo } from './island-geometry.ts';
import { ISLAND_LEVEL } from './island-options.ts';
import { openIslandWindow } from './island-window.ts';

const native = vi.hoisted(() => {
  class Window {
    bounds = { x: 0, y: 0, width: 1040, height: 600 };
    events = new Map<string, () => void>();
    webContents = { id: 1, send: vi.fn(), focus: vi.fn() };
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    setFocusable = vi.fn();
    focus = vi.fn();
    blur = vi.fn();
    hide = vi.fn();
    showInactive = vi.fn();
    loadURL = vi.fn(async () => undefined);
    isDestroyed = () => false;
    isVisible = () => true;
    getBounds = () => this.bounds;
    getPosition = () => [this.bounds.x, this.bounds.y];
    setBounds = vi.fn((bounds: typeof this.bounds) => {
      this.bounds = bounds;
    });
    on = (event: string, callback: () => void) => this.events.set(event, callback);
    destroy = () => this.events.get('closed')?.();
  }
  const window = new Window();
  return {
    window,
    displays: [] as DisplayInfo[],
    events: new Map<string, () => void>(),
    BrowserWindow: vi.fn(function (options: { x: number; y: number }) {
      window.bounds = { ...window.bounds, x: options.x, y: options.y };
      return window;
    }),
  };
});

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: native.BrowserWindow,
  globalShortcut: { register: vi.fn(), unregister: vi.fn() },
  screen: {
    getAllDisplays: () => native.displays,
    getPrimaryDisplay: () => native.displays[0],
    getDisplayNearestPoint: ({ x }: { x: number }) =>
      native.displays.find(
        (display) => x >= display.bounds.x && x < display.bounds.x + display.bounds.width,
      ) ?? native.displays[0],
    on: (event: string, callback: () => void) => native.events.set(event, callback),
    off: (event: string) => native.events.delete(event),
  },
}));
vi.mock('./window.ts', () => ({ guardNavigation: vi.fn() }));
vi.mock('./notch-probe.ts', () => ({
  emulatedNotch: () => null,
  readNotches: async () => new Map(),
}));

const internal: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 38, width: 1512, height: 944 },
  internal: true,
};
const external: DisplayInfo = {
  id: 2,
  bounds: { x: 1512, y: 0, width: 2560, height: 1440 },
  workArea: { x: 1512, y: 24, width: 2560, height: 1416 },
  internal: false,
};

function open(saved: IslandPosition = { docked: true }) {
  const savePosition = vi.fn((next: IslandPosition) => {
    saved = next;
  });
  const handle = openIslandWindow({
    origin: 'http://localhost:3000',
    preload: '/app/preload.cjs',
    position: () => saved,
    savePosition,
    onGone: vi.fn(),
  });
  return { handle, savePosition };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  native.events.clear();
  native.window.events.clear();
  native.displays = [internal, external];
});
afterEach(() => vi.useRealTimers());

describe('native island window', () => {
  it('appears on all Spaces and full-screen workspaces without taking focus', () => {
    const { handle } = open();
    expect(native.window.setAlwaysOnTop).toHaveBeenCalledWith(true, ISLAND_LEVEL);
    expect(native.window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    handle.ready();
    expect(native.window.showInactive).toHaveBeenCalled();
    expect(native.window.focus).not.toHaveBeenCalled();
    handle.destroy();
  });

  it('drags a collapsed strip using its full logical origin and retains the external dock', async () => {
    native.displays = [external, internal];
    const { handle, savePosition } = open();
    await Promise.resolve();
    handle.setRestSize({ width: 100, height: 40 });
    const origin = dockedPosition(external);
    expect(native.window.bounds.x).toBe(origin.x + (ISLAND_WIDTH - 100) / 2);
    handle.drag('start', { x: origin.x + ISLAND_WIDTH / 2, y: 10 });
    handle.drag('end', { x: origin.x + ISLAND_WIDTH / 2 + 10, y: 20 });
    expect(savePosition).toHaveBeenLastCalledWith({ docked: false, ...origin });
    expect(handle.geometry().docked).toBe(true);
    expect(native.window.bounds.x).toBe(origin.x + (ISLAND_WIDTH - 100) / 2);

    native.displays = [internal];
    native.events.get('display-removed')?.();
    expect(native.window.bounds.x).toBe(dockedPosition(internal).x);
    expect(savePosition).toHaveBeenCalledTimes(1);
    native.displays = [internal, external];
    native.events.get('display-added')?.();
    expect(native.window.bounds.x).toBe(origin.x + (ISLAND_WIDTH - 100) / 2);
    expect(savePosition).toHaveBeenCalledTimes(1);
    handle.destroy();
  });
});
