import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  afterPaint,
  sparkDesktop,
  type IslandAction,
  type IslandGeometry,
} from '../desktop/desktop-bridge.ts';
import { matchesShortcut } from '../desktop/shortcut-keys.ts';

export const HIT_MARGIN = 14;
const DRAG_START = 6;
const PROBE_GAP_MS = 16;
const REST_DELAY_MS = 700;

const BROWSER_GEOMETRY: IslandGeometry = {
  notch: true,
  top: 32,
  notchWidth: 190,
  docked: true,
  menuBar: 32,
};
const BROWSER_SHORTCUTS: Record<IslandAction, string> = {
  quick: 'Alt+Space',
  sessions: 'Alt+Shift+Space',
};

function inside(rects: readonly DOMRect[], x: number, y: number, margin = HIT_MARGIN): boolean {
  return rects.some(
    (rect) =>
      rect.width > 0 &&
      x >= rect.left - margin &&
      x <= rect.right + margin &&
      y >= rect.top - margin &&
      y <= rect.bottom + margin,
  );
}

function padded(rect: DOMRect): DOMRect {
  return new DOMRect(
    rect.x - HIT_MARGIN,
    rect.y - HIT_MARGIN,
    rect.width + 2 * HIT_MARGIN,
    rect.height + 2 * HIT_MARGIN,
  );
}

function restSize(
  rects: readonly DOMRect[],
  zone: readonly DOMRect[],
): { width: number; height: number } | null {
  const shown = rects.filter((rect) => rect.width > 0);
  if (shown.length === 0) return null;
  const taken = [...shown.map(padded), ...zone];
  const middle = window.innerWidth / 2;
  const reach = Math.max(...taken.map((rect) => Math.max(middle - rect.left, rect.right - middle)));
  return { width: 2 * reach, height: Math.max(...taken.map((rect) => rect.bottom)) };
}

interface BridgeOptions {
  coreRects: () => DOMRect[];
  blobRects: () => DOMRect[];
  zoneRects: (docked: boolean) => DOMRect[];
  peek: boolean;
  hovered: boolean;
  restKey: string;
  islandRef: RefObject<HTMLElement | null>;
  focusable: boolean;
  onHover: (inside: boolean) => void;
  onCommand: (action: IslandAction) => void;
  onBlur: () => void;
}

export function useSparkFocus(): boolean {
  const desktop = sparkDesktop();
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    void desktop.island.sparkFocused().then(setFocused);
    return desktop.island.onSparkFocus(setFocused);
  }, [desktop]);
  return focused;
}

export function useIslandBridge(options: BridgeOptions): IslandGeometry {
  const desktop = sparkDesktop();
  const [geometry, setGeometry] = useState<IslandGeometry>(BROWSER_GEOMETRY);
  const [pointerIn, setPointerIn] = useState(false);
  const hovering = useRef(false);
  const engage = useRef<() => void>(() => undefined);
  const resting = options.peek && geometry.docked && !geometry.notch;
  const latest = useRef(options);
  const docked = useRef(geometry.docked);
  useEffect(() => {
    latest.current = options;
    docked.current = geometry.docked;
  });

  useEffect(() => {
    if (!desktop) return;
    void desktop.island.geometry().then((next) => {
      if (next) setGeometry(next);
      afterPaint(() => desktop.island.ready?.());
    });
    const offGeometry = desktop.island.onGeometry(setGeometry);
    const offCommand = desktop.island.onCommand((action) => latest.current.onCommand(action));
    const offEscape = desktop.island.onEscape(() => {
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    return () => {
      offGeometry();
      offCommand();
      offEscape();
    };
  }, [desktop]);

  useEffect(() => {
    if (desktop) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = (['sessions', 'quick'] as const).find((candidate) =>
        matchesShortcut(BROWSER_SHORTCUTS[candidate], event),
      );
      if (!action) return;
      event.preventDefault();
      latest.current.onCommand(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [desktop]);

  useEffect(() => {
    let interactive = false;
    let dragging: { x: number; y: number; started: boolean; blob: boolean } | null = null;
    let dropped = false;
    const setInteractive = (on: boolean) => {
      if (on === interactive) return;
      interactive = on;
      desktop?.island.setInteractive(on);
      setPointerIn(on);
    };
    const setHover = (on: boolean) => {
      if (on === hovering.current) return;
      hovering.current = on;
      latest.current.onHover(on);
    };
    let lastProbe = -Infinity;
    let probeFrame = 0;
    let trailing: { x: number; y: number } | null = null;
    let zone: DOMRect[] = [];
    engage.current = () => setInteractive(true);
    const probe = (x: number, y: number) => {
      lastProbe = performance.now();
      trailing = null;
      const core = latest.current.coreRects();
      const blobs = latest.current.blobRects();
      const resting = latest.current.zoneRects(docked.current);
      if (resting.length > 0) zone = resting;
      else if (!hovering.current) zone = [];
      const near = inside([...core, ...blobs], x, y);
      const hit = near || inside(zone, x, y, 0);
      setInteractive(near || (hit && latest.current.hovered));
      const onCore = inside(core, x, y, 0);
      const onBlob = inside(blobs, x, y, 0);
      setHover(hit && (onCore || !onBlob));
    };
    const onMove = (event: MouseEvent) => {
      if (dragging) {
        if (
          !dragging.started &&
          Math.hypot(event.screenX - dragging.x, event.screenY - dragging.y) >= DRAG_START
        ) {
          dragging.started = true;
          if (dragging.blob) setHover(false);
          desktop?.island.drag(dragging.blob ? 'lift' : 'start', dragging.x, dragging.y);
        }
        if (dragging.started) desktop?.island.drag('move', event.screenX, event.screenY);
        return;
      }
      const now = performance.now();
      if (now - lastProbe >= PROBE_GAP_MS) {
        probe(event.clientX, event.clientY);
        return;
      }
      trailing = { x: event.clientX, y: event.clientY };
      if (!probeFrame) {
        probeFrame = requestAnimationFrame(() => {
          probeFrame = 0;
          if (trailing) probe(trailing.x, trailing.y);
        });
      }
    };
    const onLeave = () => {
      trailing = null;
      if (dragging) return;
      setInteractive(false);
      setHover(false);
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!desktop || event.button !== 0) return;
      if (!latest.current.islandRef.current?.contains(target)) return;
      const blob = target.closest('.isl-scout-btn') !== null;
      const control = target.closest(
        'button, a, input, textarea, [role="option"], [role="menu"], .isl-reply, [tabindex]',
      );
      if (control && !blob) return;
      dropped = false;
      dragging = { x: event.screenX, y: event.screenY, started: false, blob };
    };
    const onUp = (event: PointerEvent) => {
      if (dragging?.started) {
        desktop?.island.drag('end', event.screenX, event.screenY);
        dropped = dragging.blob;
      }
      dragging = null;
    };
    const onClick = (event: MouseEvent) => {
      if (!dropped) return;
      dropped = false;
      event.stopPropagation();
      event.preventDefault();
    };
    const onBlur = () => latest.current.onBlur();
    const onDragIn = () => setInteractive(true);
    const onDragOut = (event: DragEvent) => {
      if (event.type === 'drop' || !event.relatedTarget) setInteractive(false);
    };
    document.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('click', onClick, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('dragenter', onDragIn);
    window.addEventListener('drop', onDragOut);
    document.documentElement.addEventListener('dragleave', onDragOut);
    return () => {
      cancelAnimationFrame(probeFrame);
      window.removeEventListener('dragenter', onDragIn);
      window.removeEventListener('drop', onDragOut);
      document.documentElement.removeEventListener('dragleave', onDragOut);
      document.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [desktop]);

  useEffect(() => {
    if (!options.hovered) hovering.current = false;
    else if (hovering.current) engage.current();
  }, [options.hovered]);

  useEffect(() => {
    if (!desktop) return;
    desktop.island.setRestSize(null);
    if (!resting || pointerIn) return;
    const timer = setTimeout(() => {
      const { coreRects, blobRects, zoneRects } = latest.current;
      desktop.island.setRestSize(
        restSize([...coreRects(), ...blobRects()], zoneRects(docked.current)),
      );
    }, REST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [desktop, resting, pointerIn, options.restKey]);

  useEffect(() => {
    desktop?.island.setFocusable(options.focusable);
  }, [desktop, options.focusable]);

  return geometry;
}
