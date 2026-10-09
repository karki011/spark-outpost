import { app, BrowserWindow, globalShortcut, screen, type Display } from 'electron';
import type { IslandPosition, ShortcutAction } from './companion-settings.ts';
import type { IslandHandle } from './companion.ts';
import {
  clampToDisplay,
  dockedPosition,
  draggedPosition,
  islandBounds,
  islandGeometry,
  liftedPosition,
  movedPosition,
  nearDock,
  placement,
  placementLine,
  type DisplayInfo,
  type IslandGeometry,
  type Point,
  type Rect,
  type Size,
} from './island-geometry.ts';
import { emulatedNotch, readNotches, type Notches } from './notch-probe.ts';
import { escapeGuard } from './island-escape.ts';
import { setIslandFocus } from './island-focus.ts';
import { ISLAND_LEVEL, ISLAND_PATH, islandWindowOptions } from './island-options.ts';
import { islandVisibility } from './island-visibility.ts';
import { IPC, type DragPhase } from './ipc-channels.ts';
import { revealGate } from './reveal-gate.ts';
import { guardNavigation } from './window.ts';

const READY_FALLBACK_MS = 8_000;

export interface IslandWindow extends IslandHandle {
  owns(webContentsId: number): boolean;
  ready(): void;
  setInteractive(on: boolean): void;
  setFocusable(on: boolean): void;
  drag(phase: DragPhase, pointer: Point): void;
  setRestSize(size: Size | null): void;
  sparkFocus(focused: boolean): void;
  geometry(): IslandGeometry;
}

interface IslandWindowOptions {
  origin: string;
  preload: string;
  position: () => IslandPosition;
  savePosition: (position: IslandPosition) => void;
  onGone: () => void;
  log: (line: string) => void;
}

export function openIslandWindow(options: IslandWindowOptions): IslandWindow {
  const emulated = app.isPackaged ? null : emulatedNotch(process.env.SPARK_ISLAND_NOTCH);
  let notches: Notches = new Map();
  const info = (display: Display): DisplayInfo => ({
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    internal: display.internal,
    notch: emulated ?? notches.get(display.id),
  });
  const currentPlacement = (saved: IslandPosition) =>
    placement(saved, screen.getAllDisplays().map(info), screen.getPrimaryDisplay().id);
  let placed = currentPlacement(options.position());
  const start = placed?.position ?? { x: 0, y: 0 };
  const window = new BrowserWindow(islandWindowOptions(options.preload, start));
  let dragging: { origin: Point; pointer: Point } | null = null;
  let rest: Size | null = null;
  let interactive = false;
  let requested: Rect | null = null;
  let logged = '';
  let sentTop = 0;

  window.setAlwaysOnTop(true, ISLAND_LEVEL);
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  window.setIgnoreMouseEvents(true, { forward: true });
  guardNavigation(window, options.origin);

  const geometry = (): IslandGeometry =>
    placed && !window.isDestroyed()
      ? islandGeometry(placed.display, placed.docked, window.getBounds().y)
      : {
          notch: false,
          top: 32,
          notchWidth: 0,
          notchHeight: 0,
          docked: true,
          menuBar: 0,
          windowTop: 0,
        };

  const send = (channel: string, payload: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };

  const resting = (): Size | null =>
    placed?.docked && !geometry().notch && !dragging ? rest : null;

  const applyMouse = () => {
    if (window.isDestroyed()) return;
    window.setIgnoreMouseEvents(!(interactive || resting() !== null), { forward: true });
  };

  const report = (reason: string) => {
    if (app.isPackaged || window.isDestroyed()) return;
    console.log(`[island] ${reason}: ${JSON.stringify(window.getBounds())}`);
  };

  const escape = escapeGuard(globalShortcut, () => send(IPC.islandEscape, null));

  const moveTo = (position: Point, animate = false) => {
    requested = islandBounds(position, resting());
    window.setBounds(requested, animate);
  };

  const settle = () => {
    if (window.isDestroyed() || !placed || !requested) return;
    const line = placementLine(placed.display, placed.docked, requested, window.getBounds());
    if (line !== logged) options.log(line);
    logged = line;
    const next = geometry();
    sentTop = next.windowTop;
    send(IPC.islandGeometryChanged, next);
  };

  const place = () => {
    if (window.isDestroyed() || dragging) return;
    placed = currentPlacement(options.position());
    if (!placed) return;
    moveTo(placed.position);
    settle();
  };

  const measure = () => {
    if (emulated) return;
    void readNotches().then((next) => {
      if (window.isDestroyed()) return;
      notches = next;
      place();
    });
  };
  const onDisplays = () => {
    place();
    measure();
  };
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', onDisplays);
  measure();
  const showNow = (reason: string) => {
    if (window.isDestroyed()) return;
    if (placed) moveTo(placed.position);
    window.showInactive();
    report(reason);
    settle();
  };
  const reveal = revealGate(() => {
    if (!visibility.hidden()) showNow('shown');
  }, READY_FALLBACK_MS);
  const visibility = islandVisibility({
    show: () => {
      if (reveal.revealed()) showNow('shown again');
    },
    hide: () => {
      if (window.isDestroyed()) return;
      setIslandFocus(window, false);
      escape.arm(false);
      window.hide();
      report('hidden');
    },
  });
  window.on('move', () => {
    if (dragging || window.isDestroyed() || geometry().windowTop === sentTop) return;
    settle();
  });
  window.on('closed', () => {
    reveal.cancel();
    visibility.cancel();
    escape.arm(false);
    screen.off('display-added', onDisplays);
    screen.off('display-removed', onDisplays);
    screen.off('display-metrics-changed', onDisplays);
    options.onGone();
  });
  void window.loadURL(`${options.origin}${ISLAND_PATH}`);

  const finishDrag = (pointer: Point) => {
    if (!dragging) return;
    const display = info(screen.getDisplayNearestPoint(pointer));
    const dropped = movedPosition(dragging.origin, dragging.pointer, pointer);
    const docked = nearDock(dropped, display);
    const settled = docked ? dockedPosition(display) : clampToDisplay(dropped, display);
    dragging = null;
    options.savePosition({ docked: false, ...settled });
    placed = { display, position: settled, docked };
    moveTo(settled, docked);
    settle();
  };

  return {
    owns: (id) => !window.isDestroyed() && window.webContents.id === id,
    ready: reveal.ready,
    destroy: () => {
      if (!window.isDestroyed()) window.destroy();
    },
    command: (action: ShortcutAction) => {
      if (window.isDestroyed()) return;
      visibility.summon();
      reveal.ready();
      if (!window.isVisible()) window.showInactive();
      send(IPC.islandCommand, action);
    },
    setInteractive: (on) => {
      interactive = on;
      applyMouse();
    },
    setFocusable: (on) => {
      setIslandFocus(window, on);
      escape.arm(on && !window.isDestroyed());
    },
    sparkFocus: (focused) => {
      visibility.sparkFocus(focused);
      send(IPC.islandSparkFocus, focused);
    },
    setRestSize: (size) => {
      const changed = JSON.stringify(size) !== JSON.stringify(rest);
      rest = size;
      if (!changed || window.isDestroyed() || dragging || !placed) return;
      moveTo(placed.position);
      applyMouse();
      report(size ? 'resting' : 'expanded');
    },
    drag: (phase, pointer) => {
      if (window.isDestroyed()) return;
      if (phase === 'start') {
        const [x = 0, y = 0] = window.getPosition();
        dragging = { origin: placed?.position ?? { x, y }, pointer };
        return;
      }
      if (phase === 'lift') {
        const host = info(screen.getDisplayNearestPoint(pointer));
        const origin = liftedPosition(pointer);
        dragging = { origin, pointer };
        placed = { display: host, position: clampToDisplay(origin, host), docked: false };
        moveTo(placed.position);
        send(IPC.islandGeometryChanged, geometry());
        return;
      }
      if (!dragging) return;
      const display = info(screen.getDisplayNearestPoint(pointer));
      if (phase === 'move') {
        moveTo(draggedPosition(dragging.origin, dragging.pointer, pointer, display));
        return;
      }
      finishDrag(pointer);
    },
    geometry,
  };
}
