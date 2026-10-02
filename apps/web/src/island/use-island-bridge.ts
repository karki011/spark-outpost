import { useEffect, useRef, useState, type RefObject } from 'react';
import { sparkDesktop, type IslandAction, type IslandGeometry } from '../desktop/desktop-bridge.ts';
import { matchesShortcut } from '../desktop/shortcut-keys.ts';

export const HIT_MARGIN = 14;
const DRAG_START = 6;

const BROWSER_GEOMETRY: IslandGeometry = { notch: true, top: 32, notchWidth: 190, docked: true };
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

interface BridgeOptions {
  hitRects: () => DOMRect[];
  blobRects: () => DOMRect[];
  islandRef: RefObject<HTMLElement | null>;
  focusable: boolean;
  onHover: (inside: boolean) => void;
  onCommand: (action: IslandAction) => void;
  onBlur: () => void;
}

export function useIslandBridge(options: BridgeOptions): IslandGeometry {
  const desktop = sparkDesktop();
  const [geometry, setGeometry] = useState<IslandGeometry>(BROWSER_GEOMETRY);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!desktop) return;
    void desktop.island.geometry().then((next) => next && setGeometry(next));
    const offGeometry = desktop.island.onGeometry(setGeometry);
    const offCommand = desktop.island.onCommand((action) => latest.current.onCommand(action));
    return () => {
      offGeometry();
      offCommand();
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
    let hovering = false;
    let dragging: { x: number; y: number; started: boolean } | null = null;
    const setInteractive = (on: boolean) => {
      if (on === interactive) return;
      interactive = on;
      desktop?.island.setInteractive(on);
    };
    const setHover = (on: boolean) => {
      if (on === hovering) return;
      hovering = on;
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
      const hit = inside(latest.current.hitRects(), event.clientX, event.clientY);
      setInteractive(hit);
      const island = latest.current.islandRef.current?.getBoundingClientRect();
      const onIsland = island ? inside([island], event.clientX, event.clientY, 0) : false;
      const onBlob = inside(latest.current.blobRects(), event.clientX, event.clientY, 0);
      setHover(hit && (onIsland || !onBlob));
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
    document.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [desktop]);

  useEffect(() => {
    desktop?.island.setFocusable(options.focusable);
  }, [desktop, options.focusable]);

  return geometry;
}
