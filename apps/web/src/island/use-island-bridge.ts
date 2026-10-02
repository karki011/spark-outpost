import { useEffect, useRef, useState, type RefObject } from 'react';
import { sparkDesktop, type IslandAction, type IslandGeometry } from '../desktop/desktop-bridge.ts';
import { matchesShortcut } from '../desktop/shortcut-keys.ts';

export const HIT_MARGIN = 14;
const DRAG_START = 6;
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

function restSize(rects: readonly DOMRect[]): { width: number; height: number } | null {
  const shown = rects.filter((rect) => rect.width > 0);
  if (shown.length === 0) return null;
  const middle = window.innerWidth / 2;
  const reach = Math.max(...shown.map((rect) => Math.max(middle - rect.left, rect.right - middle)));
  const bottom = Math.max(...shown.map((rect) => rect.bottom));
  return { width: 2 * (reach + HIT_MARGIN), height: bottom + HIT_MARGIN };
}

interface BridgeOptions {
  coreRects: () => DOMRect[];
  blobRects: () => DOMRect[];
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
  const resting = options.peek && geometry.docked && !geometry.notch;
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!desktop) return;
    void desktop.island.geometry().then((next) => next && setGeometry(next));
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
    let dragging: { x: number; y: number; started: boolean } | null = null;
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
    const onMove = (event: MouseEvent) => {
      if (dragging) {
        if (
          !dragging.started &&
          Math.hypot(event.screenX - dragging.x, event.screenY - dragging.y) >= DRAG_START
        ) {
          dragging.started = true;
          desktop?.island.drag('start', dragging.x, dragging.y);
        }
        if (dragging.started) desktop?.island.drag('move', event.screenX, event.screenY);
        return;
      }
      const core = latest.current.coreRects();
      const blobs = latest.current.blobRects();
      const hit = inside([...core, ...blobs], event.clientX, event.clientY);
      setInteractive(hit);
      const onCore = inside(core, event.clientX, event.clientY, 0);
      const onBlob = inside(blobs, event.clientX, event.clientY, 0);
      setHover(hit && (onCore || !onBlob));
    };
    const onLeave = () => {
      if (dragging) return;
      setInteractive(false);
      setHover(false);
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!desktop || event.button !== 0) return;
      if (!latest.current.islandRef.current?.contains(target)) return;
      if (
        target.closest(
          'button, a, input, textarea, [role="option"], [role="menu"], .isl-reply, [tabindex]',
        )
      )
        return;
      dragging = { x: event.screenX, y: event.screenY, started: false };
    };
    const onUp = (event: PointerEvent) => {
      if (dragging?.started) desktop?.island.drag('end', event.screenX, event.screenY);
      dragging = null;
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
    window.addEventListener('blur', onBlur);
    window.addEventListener('dragenter', onDragIn);
    window.addEventListener('drop', onDragOut);
    document.documentElement.addEventListener('dragleave', onDragOut);
    return () => {
      window.removeEventListener('dragenter', onDragIn);
      window.removeEventListener('drop', onDragOut);
      document.documentElement.removeEventListener('dragleave', onDragOut);
      document.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [desktop]);

  useEffect(() => {
    if (!options.hovered) hovering.current = false;
  }, [options.hovered]);

  useEffect(() => {
    if (!desktop) return;
    if (!resting || pointerIn) {
      desktop.island.setRestSize(null);
      return;
    }
    const timer = setTimeout(() => {
      const { coreRects, blobRects } = latest.current;
      desktop.island.setRestSize(restSize([...coreRects(), ...blobRects()]));
    }, REST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [desktop, resting, pointerIn, options.restKey]);

  useEffect(() => {
    desktop?.island.setFocusable(options.focusable);
  }, [desktop, options.focusable]);

  return geometry;
}
