import { BrowserWindow, screen, type Display } from 'electron';
import type { IslandPosition, ShortcutAction } from './companion-settings.ts';
import type { IslandHandle } from './companion.ts';
import {
  dockedPosition,
  draggedPosition,
  islandGeometry,
  nearDock,
  placement,
  ISLAND_HEIGHT,
  ISLAND_WIDTH,
  type DisplayInfo,
  type IslandGeometry,
  type Point,
} from './island-geometry.ts';
import { ISLAND_LEVEL, ISLAND_PATH, islandWindowOptions } from './island-options.ts';
import { IPC, type DragPhase } from './ipc-channels.ts';
import { guardNavigation } from './window.ts';

export interface IslandWindow extends IslandHandle {
  owns(webContentsId: number): boolean;
  setInteractive(on: boolean): void;
  setFocusable(on: boolean): void;
  drag(phase: DragPhase, pointer: Point): void;
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
      : { notch: false, top: 32, notchWidth: 0, docked: true };

  const send = (channel: string, payload: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };

  const moveTo = (position: Point, animate = false) => {
    window.setBounds({ ...position, width: ISLAND_WIDTH, height: ISLAND_HEIGHT }, animate);
  };

  const place = () => {
    if (window.isDestroyed() || dragging) return;
    placed = currentPlacement(options.position());
    if (!placed) return;
    if (placed.docked) options.savePosition({ docked: true });
    moveTo(placed.position);
    send(IPC.islandGeometryChanged, geometry());
  };

  screen.on('display-added', place);
  screen.on('display-removed', place);
  screen.on('display-metrics-changed', place);
  window.once('ready-to-show', () => {
    if (placed) moveTo(placed.position);
    window.showInactive();
  });
  window.on('closed', () => {
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
    } else {
      options.savePosition({ docked: false, x, y });
      placed = { display, position: { x, y }, docked: false };
    }
    send(IPC.islandGeometryChanged, geometry());
  };

  return {
    owns: (id) => !window.isDestroyed() && window.webContents.id === id,
    destroy: () => {
      if (!window.isDestroyed()) window.destroy();
    },
    command: (action: ShortcutAction) => {
      if (window.isDestroyed()) return;
      if (!window.isVisible()) window.showInactive();
      send(IPC.islandCommand, action);
    },
    setInteractive: (on) => {
      if (!window.isDestroyed()) window.setIgnoreMouseEvents(!on, { forward: true });
    },
    setFocusable: (on) => {
      if (window.isDestroyed()) return;
      if (on) {
        window.setFocusable(true);
        window.focus();
        return;
      }
      window.blur();
      window.setFocusable(false);
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
