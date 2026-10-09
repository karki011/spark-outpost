import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IslandPosition, IslandSize } from './companion-settings.ts';
import {
  dockedPosition,
  floatingBlob,
  ISLAND_WIDTH,
  type DisplayInfo,
  type IslandGeometry,
} from './island-geometry.ts';
import { IPC } from './ipc-channels.ts';
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
    lowered = 0;
    setBounds = vi.fn((bounds: typeof this.bounds) => {
      this.bounds = { ...bounds, y: bounds.y + this.lowered };
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

const FLOATING_BLOB = floatingBlob(58);
let size: IslandSize = 'full';

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
    size: () => size,
    savePosition,
    onGone: vi.fn(),
    log,
  });
  return { handle, savePosition };
}

const log = vi.fn<(line: string) => void>();
const sentGeometry = () =>
  native.window.webContents.send.mock.calls
    .filter(([channel]) => channel === IPC.islandGeometryChanged)
    .map(([, geometry]) => geometry as IslandGeometry);

beforeEach(() => {
  size = 'full';
  vi.useFakeTimers();
  vi.clearAllMocks();
  native.events.clear();
  native.window.events.clear();
  native.window.lowered = 0;
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

  it('tells the page where the window really is when macOS puts it lower than asked', () => {
    native.displays = [internal];
    native.window.lowered = 38;
    const { handle } = open();
    native.events.get('display-metrics-changed')?.();
    const dock = dockedPosition(internal);
    expect(native.window.setBounds).toHaveBeenLastCalledWith(
      { ...dock, width: ISLAND_WIDTH, height: 600 },
      false,
    );
    expect(sentGeometry().at(-1)).toMatchObject({ docked: true, notchHeight: 38, windowTop: 38 });
    expect(handle.geometry().windowTop).toBe(38);
    expect(log).toHaveBeenLastCalledWith(
      `Island placed: display 1512x982 at 0,0; work area 1512x944 at 0,38; notch 190x38 (from menu bar); docked, blob 58 tucked 31 at rest, requested 1040x600 at ${dock.x},0; actual 1040x600 at ${dock.x},38`,
    );

    native.window.lowered = 0;
    native.events.get('display-metrics-changed')?.();
    expect(sentGeometry().at(-1)).toMatchObject({ windowTop: 0 });
    handle.destroy();
  });

  it('reports the real window top after a drag back to the dock', () => {
    native.displays = [internal];
    const { handle } = open();
    const dock = dockedPosition(internal);
    handle.drag('start', { x: dock.x + 500, y: 10 });
    handle.drag('move', { x: dock.x + 500, y: 400 });
    native.window.lowered = 38;
    handle.drag('end', { x: dock.x + 510, y: 12 });
    expect(sentGeometry().at(-1)).toMatchObject({ docked: true, windowTop: 38 });
    expect(log).toHaveBeenLastCalledWith(
      expect.stringContaining(`actual 1040x600 at ${dock.x},38`),
    );
    handle.destroy();
  });

  it('follows a window that macOS moves after it was placed, and logs each placement once', () => {
    native.displays = [internal];
    const { handle } = open();
    handle.ready();
    native.events.get('display-metrics-changed')?.();
    expect(log).toHaveBeenCalledTimes(1);
    const before = sentGeometry().length;
    native.window.events.get('move')?.();
    expect(sentGeometry()).toHaveLength(before);

    native.window.bounds = { ...native.window.bounds, y: 38 };
    native.window.events.get('move')?.();
    expect(sentGeometry()).toHaveLength(before + 1);
    expect(sentGeometry().at(-1)).toMatchObject({ windowTop: 38 });
    expect(log).toHaveBeenCalledTimes(2);
    handle.destroy();
  });
});

describe('dragging the resting blob', () => {
  const centre = internal.bounds.width / 2;
  const underNotch = centre - FLOATING_BLOB.x - FLOATING_BLOB.size / 2;

  it('floats a blob lifted just under the notch and leaves it exactly there', () => {
    native.displays = [internal];
    const { handle, savePosition } = open();
    handle.drag('lift', { x: centre, y: 71 });
    expect(sentGeometry().at(-1)).toMatchObject({ docked: false });
    expect(native.window.bounds).toMatchObject({ x: underNotch, y: 42 });
    handle.drag('move', { x: centre, y: 69 });
    expect(native.window.bounds.y).toBe(40);
    handle.drag('end', { x: centre, y: 67 });
    expect(savePosition).toHaveBeenLastCalledWith({ docked: false, x: underNotch, y: 38 });
    expect(native.window.bounds).toMatchObject({ x: underNotch, y: 38 });
    expect(handle.geometry()).toMatchObject({ docked: false, windowTop: 38 });
    expect(log).toHaveBeenLastCalledWith(
      expect.stringContaining(
        `floating, blob 58 not tucked, requested 1040x600 at ${underNotch},38; actual`,
      ),
    );
    handle.destroy();
  });

  it('holds a blob dragged into the notch under it, and docks it when dropped there', () => {
    native.displays = [internal];
    const { handle, savePosition } = open({ docked: false, x: underNotch, y: 120 });
    handle.drag('lift', { x: centre, y: 149 });
    handle.drag('move', { x: centre, y: 20 });
    expect(native.window.bounds).toMatchObject({ x: underNotch, y: 38 });
    handle.drag('end', { x: centre, y: 20 });
    expect(savePosition).toHaveBeenLastCalledWith({ docked: false, ...dockedPosition(internal) });
    expect(handle.geometry()).toMatchObject({ docked: true, windowTop: 0 });
    expect(log).toHaveBeenLastCalledWith(
      expect.stringContaining('docked, blob 58 tucked 31 at rest, requested'),
    );
    handle.destroy();
  });

  it('logs the placement again for a new size and lifts the bigger blob by its centre', () => {
    native.displays = [internal];
    const { handle } = open();
    handle.ready();
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('docked, blob 58 tucked 31'));
    size = 'xlarge';
    handle.sizeChanged();
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('docked, blob 116 tucked 61'));
    handle.drag('lift', { x: centre, y: 300 });
    expect(native.window.bounds).toMatchObject({ x: centre - ISLAND_WIDTH / 2, y: 300 - 58 });
    handle.drag('end', { x: centre, y: 300 });
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('floating, blob 116 not tucked'));
    handle.destroy();
  });

  it('lets the blob rest against the top edge of a display without a notch', () => {
    native.displays = [external];
    const { handle, savePosition } = open();
    const pointer = external.bounds.x + 900;
    handle.drag('lift', { x: pointer, y: 40 });
    handle.drag('end', { x: pointer, y: 2 });
    const x = pointer - FLOATING_BLOB.x - FLOATING_BLOB.size / 2;
    expect(savePosition).toHaveBeenLastCalledWith({ docked: false, x, y: 0 });
    expect(native.window.bounds).toMatchObject({ x, y: 0 });
    expect(handle.geometry().docked).toBe(false);
    handle.destroy();
  });

  it('comes back at the saved spot after a relaunch and when its display returns', () => {
    native.displays = [internal, external];
    const saved = { docked: false as const, x: underNotch, y: 38 };
    const { handle, savePosition } = open(saved);
    expect(native.BrowserWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: saved.x, y: saved.y }),
    );
    handle.ready();
    expect(handle.geometry()).toMatchObject({ docked: false });
    expect(log).toHaveBeenLastCalledWith(
      expect.stringContaining(
        `floating, blob 58 not tucked, requested 1040x600 at ${underNotch},38`,
      ),
    );
    native.displays = [external];
    native.events.get('display-removed')?.();
    expect(handle.geometry().docked).toBe(true);
    native.displays = [internal, external];
    native.events.get('display-added')?.();
    expect(native.window.bounds).toMatchObject({ x: underNotch, y: 38 });
    expect(savePosition).not.toHaveBeenCalled();
    handle.destroy();
  });
});
