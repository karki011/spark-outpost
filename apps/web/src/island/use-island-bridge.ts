import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  afterPaint,
  sparkDesktop,
  type IslandAction,
  type IslandGeometry,
} from '../desktop/desktop-bridge.ts';
import { matchesShortcut } from '../desktop/shortcut-keys.ts';
import {
  MENU_QUIET_MS,
  onScout,
  pointerIntent,
  pointerSpeed,
  scoutHit,
  scoutRects,
  SETTLE_MS,
  type PointerSample,
} from './island-hover.ts';
import { HIT_MARGIN, islandRegions, restGrows, restSize, type RestSize } from './island-regions.ts';
import { useIslandLayout } from './use-island-layout.ts';

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

interface BridgeOptions {
  coreRects: () => DOMRect[];
  blobRects: () => DOMRect[];
  peek: boolean;
  strip?: boolean;
  hovered: boolean;
  islandRef: RefObject<HTMLElement | null>;
  focusable: boolean;
  onHover: (inside: boolean) => void;
  onCommand: (action: IslandAction) => void;
  onBlur: () => void;
  onMenuBar?: (busy: boolean) => void;
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
  const hovering = useRef(false);
  const sentRegions = useRef('');
  const remeasureRef = useRef<() => void>(() => undefined);
  const sentRest = useRef<RestSize | null | undefined>(undefined);
  const shrinkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resting = options.peek && geometry.docked && !geometry.notch;
  const latest = useRef(options);
  const geometryRef = useRef(geometry);
  useEffect(() => {
    latest.current = options;
    geometryRef.current = geometry;
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
    let held = false;
    let dragging: { x: number; y: number; started: boolean; blob: boolean } | null = null;
    let dropped = false;
    const hold = (on: boolean) => {
      if (on === held) return;
      held = on;
      desktop?.island.setInteractive(on);
    };
    const setHover = (on: boolean) => {
      if (on === hovering.current) return;
      hovering.current = on;
      latest.current.onHover(on);
    };
    const leaveWhenHidden = () => {
      if (document.visibilityState === 'hidden') setHover(false);
    };
    document.addEventListener('visibilitychange', leaveWhenHidden);
    let lastProbe = -Infinity;
    let probeFrame = 0;
    let trailing: { x: number; y: number } | null = null;
    let sample: PointerSample | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let menuBusy = false;
    const menuBar = (busy: boolean) => {
      clearTimeout(quietTimer);
      if (busy) {
        if (!menuBusy) latest.current.onMenuBar?.(true);
        menuBusy = true;
        return;
      }
      if (!menuBusy) return;
      quietTimer = setTimeout(() => {
        menuBusy = false;
        latest.current.onMenuBar?.(false);
      }, MENU_QUIET_MS);
    };
    const probe = (x: number, y: number) => {
      lastProbe = performance.now();
      trailing = null;
      remeasureRef.current();
      const { coreRects, islandRef, peek, strip } = latest.current;
      const onBlob = onScout(islandRef.current, x, y);
      const onIsland = onBlob || ((!peek || strip === true) && inside(coreRects(), x, y));
      const next = { x, y, at: lastProbe };
      const speed = pointerSpeed(sample, next);
      sample = next;
      const { menuBar: bar, windowTop } = geometryRef.current;
      const intent = pointerIntent({ onIsland, speed, y, menuBar: bar - (windowTop ?? 0) });
      clearTimeout(settleTimer);
      if (intent === 'passing') {
        settleTimer = setTimeout(() => probe(x, y), SETTLE_MS);
        return;
      }
      menuBar(intent === 'menu-bar');
      setHover(intent === 'hover');
    };
    const onMove = (event: MouseEvent) => {
      if (dragging) {
        if (
          !dragging.started &&
          Math.hypot(event.screenX - dragging.x, event.screenY - dragging.y) >= DRAG_START
        ) {
          dragging.started = true;
          hold(true);
          if (dragging.blob) setHover(false);
          desktop?.island.drag(dragging.blob ? 'lift' : 'start', dragging.x, dragging.y);
        }
        if (dragging.started) desktop?.island.drag('move', event.screenX, event.screenY);
        return;
      }
      desktop?.island.pointerMoved?.();
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
    const onLeave = (event: MouseEvent) => {
      trailing = null;
      clearTimeout(settleTimer);
      const { menuBar: bar, windowTop } = geometryRef.current;
      if (event.clientY <= bar - (windowTop ?? 0)) {
        menuBar(true);
        menuBar(false);
      }
      if (dragging) return;
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
        hold(false);
      }
      dragging = null;
    };
    const onClick = (event: MouseEvent) => {
      if (!dropped) return;
      dropped = false;
      event.stopPropagation();
      event.preventDefault();
    };
    const onBlur = () => {
      menuBar(true);
      menuBar(false);
      latest.current.onBlur();
    };
    const onDragIn = () => hold(true);
    const onDragOut = (event: DragEvent) => {
      if (event.type === 'drop' || !event.relatedTarget) hold(false);
    };
    const offPointer = desktop?.island.onPointer?.((point) => probe(point.x, point.y));
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
      clearTimeout(settleTimer);
      clearTimeout(quietTimer);
      offPointer?.();
      document.removeEventListener('visibilitychange', leaveWhenHidden);
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
  }, [options.hovered]);

  const sendRest = (size: RestSize | null) => {
    clearTimeout(shrinkTimer.current);
    if (
      sentRest.current !== undefined &&
      JSON.stringify(size) === JSON.stringify(sentRest.current)
    ) {
      return;
    }
    sentRest.current = size;
    desktop?.island.setRestSize(size);
  };
  const shrinkLater = (size: RestSize | null) => {
    clearTimeout(shrinkTimer.current);
    shrinkTimer.current = setTimeout(() => sendRest(size), REST_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(shrinkTimer.current), []);

  const remeasure = useIslandLayout(
    () => {
      if (!desktop) return;
      const { coreRects, blobRects, islandRef, peek } = latest.current;
      const core = coreRects();
      const blobs = blobRects();
      const regions = islandRegions({
        width: window.innerWidth,
        core,
        blobs,
        scout: scoutHit(islandRef.current),
        peek,
      });
      const key = JSON.stringify(regions);
      if (key !== sentRegions.current) {
        sentRegions.current = key;
        desktop.island.setRegions?.(regions);
      }
      if (!resting) {
        sendRest(null);
        return;
      }
      const next = restSize(
        [...core, ...blobs, ...scoutRects(islandRef.current)],
        window.innerWidth,
      );
      if (restGrows(next, sentRest.current)) sendRest(next);
      else if (JSON.stringify(next) !== JSON.stringify(sentRest.current)) shrinkLater(next);
    },
    `${resting}:${geometry.windowTop ?? 0}`,
  );
  useEffect(() => {
    remeasureRef.current = remeasure;
  });

  useEffect(() => {
    desktop?.island.setFocusable(options.focusable);
  }, [desktop, options.focusable]);

  return geometry;
}
