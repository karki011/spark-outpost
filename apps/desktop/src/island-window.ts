import { app, BrowserWindow, globalShortcut, screen, type Display } from 'electron';
import type { IslandPosition, ShortcutAction } from './companion-settings.ts';
import type { IslandHandle } from './companion.ts';
import {
  dockedPosition,
  draggedPosition,
  islandBounds,
  islandGeometry,
  nearDock,
  placement,
  type DisplayInfo,
  type IslandGeometry,
  type Point,
  type Size,
} from './island-geometry.ts';
import { escapeGuard } from './island-escape.ts';
import { setIslandFocus } from './island-focus.ts';
import { ISLAND_LEVEL, ISLAND_PATH, islandWindowOptions } from './island-options.ts';
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
}

function info(display: Display): DisplayInfo {
  return {
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    internal: display.internal,
  };
}

function currentPlacement(saved: IslandPosition) {
  return placement(saved, screen.getAllDisplays().map(info), screen.getPrimaryDisplay().id);
}

export function openIslandWindow(options: IslandWindowOptions): IslandWindow {
  let placed = currentPlacement(options.position());
  const start = placed?.position ?? { x: 0, y: 0 };
  const window = new BrowserWindow(islandWindowOptions(options.preload, start));
  let dragging: { origin: Point; pointer: Point } | null = null;
  let rest: Size | null = null;
  let interactive = false;

  window.setAlwaysOnTop(true, ISLAND_LEVEL);
  window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  window.setIgnoreMouseEvents(true, { forward: true });
  guardNavigation(window, options.origin);

  const geometry = (): IslandGeometry =>
    placed
      ? islandGeometry(placed.display, placed.docked)
      : { notch: false, top: 32, notchWidth: 0, docked: true, menuBar: 0 };

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
    window.setBounds(islandBounds(position, resting()), animate);
  };

  const place = () => {
    if (window.isDestroyed() || dragging) return;
    placed = currentPlacement(options.position());
    if (!placed) return;
    if (placed.docked) options.savePosition({ docked: true });
    moveTo(placed.position);
    report('placed');
    send(IPC.islandGeometryChanged, geometry());
  };

  screen.on('display-added', place);
  screen.on('display-removed', place);
  screen.on('display-metrics-changed', place);
  const reveal = revealGate(() => {
    if (window.isDestroyed()) return;
    if (placed) moveTo(placed.position);
    window.showInactive();
    report('shown');
  }, READY_FALLBACK_MS);
  window.on('closed', () => {
    reveal.cancel();
    escape.arm(false);
    screen.off('display-added', place);
    screen.off('display-removed', place);
    screen.off('display-metrics-changed', place);
    options.onGone();
  });
  void window.loadURL(`${options.origin}${ISLAND_PATH}`);

  const finishDrag = (pointer: Point) => {
    const [x = 0, y = 0] = window.getPosition();
    const display = info(screen.getDisplayNearestPoint(pointer));
    if (nearDock({ x, y }, display)) {
      options.savePosition({ docked: true });
      placed = { display, position: dockedPosition(display), docked: true };
      moveTo(placed.position, true);
      report('docked');
    } else {
      options.savePosition({ docked: false, x, y });
      placed = { display, position: { x, y }, docked: false };
    }
    send(IPC.islandGeometryChanged, geometry());
  };

  return {
    owns: (id) => !window.isDestroyed() && window.webContents.id === id,
    ready: reveal.ready,
    destroy: () => {
      if (!window.isDestroyed()) window.destroy();
    },
    command: (action: ShortcutAction) => {
      if (window.isDestroyed()) return;
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
    sparkFocus: (focused) => send(IPC.islandSparkFocus, focused),
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
        dragging = { origin: { x, y }, pointer };
        return;
      }
      if (!dragging) return;
      const display = info(screen.getDisplayNearestPoint(pointer));
      if (phase === 'move') {
        moveTo(draggedPosition(dragging.origin, dragging.pointer, pointer, display));
        return;
      }
      dragging = null;
      finishDrag(pointer);
    },
    geometry,
  };
}
