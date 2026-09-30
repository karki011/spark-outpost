import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { bindInput } from './engine-input.ts';
import { MapEngine, type EngineCallbacks } from './engine.ts';
import type { MapView, Rect } from './frame.ts';

export interface SkyHandle {
  showBridge: (key: string | null) => void;
}

interface SkyCanvasProps {
  handle: Ref<SkyHandle>;
  view: MapView;
  openArea: number | null;
  label: string;
  revealNonce: number;
  flyTarget: { file: number; nonce: number } | null;
  callbacks: Omit<EngineCallbacks, 'reserved'>;
}

const ZOOM_STEP = 1.6;
const OVERLAY_GAP = 6;

function overlayRects(stage: HTMLElement): Rect[] {
  const origin = stage.getBoundingClientRect();
  return [...stage.querySelectorAll<HTMLElement>('[data-map-overlay]')].map((element) => {
    const box = element.getBoundingClientRect();
    return [
      box.left - origin.left - OVERLAY_GAP,
      box.top - origin.top - OVERLAY_GAP,
      box.right - origin.left + OVERLAY_GAP,
      box.bottom - origin.top + OVERLAY_GAP,
    ];
  });
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function SkyCanvas({
  handle,
  view,
  openArea,
  label,
  revealNonce,
  flyTarget,
  callbacks,
}: SkyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MapEngine | null>(null);
  const latest = useLatest(callbacks);
  useImperativeHandle(handle, () => ({
    showBridge: (key) => engineRef.current?.showBridge(key),
  }));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new MapEngine(canvas, {
      hover: (target, x, y) => latest.current.hover(target, x, y),
      openFile: (file) => latest.current.openFile(file),
      openArea: (area) => latest.current.openArea(area),
      pickBridge: (key) => latest.current.pickBridge(key),
      clickSky: () => latest.current.clickSky(),
      back: () => latest.current.back(),
      announce: (text) => latest.current.announce(text),
      revealed: (shown, total, last) => latest.current.revealed(shown, total, last),
      wantFiles: (candidates) => latest.current.wantFiles(candidates),
      reserved: () => overlayRects(canvas.parentElement!),
    });
    engineRef.current = engine;
    const unbind = bindInput(engine);
    const stage = canvas.parentElement!;
    const resize = new ResizeObserver(() => {
      const rect = stage.getBoundingClientRect();
      engine.resize(rect.width, rect.height);
    });
    resize.observe(stage);
    const overlays = new MutationObserver(() => engine.invalidate());
    overlays.observe(stage, { childList: true });
    const themes = new MutationObserver(() => engine.refreshPalette());
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin'] });
    const dark = matchMedia('(prefers-color-scheme: dark)');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const repaint = () => engine.refreshPalette();
    const setMotion = () => {
      engine.reduced = motion.matches;
      engine.invalidate();
    };
    dark.addEventListener('change', repaint);
    motion.addEventListener('change', setMotion);
    void document.fonts?.ready.then(() => engine.invalidate());
    return () => {
      unbind();
      resize.disconnect();
      overlays.disconnect();
      themes.disconnect();
      dark.removeEventListener('change', repaint);
      motion.removeEventListener('change', setMotion);
      engine.destroy();
      engineRef.current = null;
    };
  }, [latest]);

  useEffect(() => {
    engineRef.current?.setView(view);
  }, [view]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (openArea === null) engine.exitArea();
    else engine.enterArea(openArea);
  }, [openArea, view.scene]);

  useEffect(() => {
    if (revealNonce > 0) engineRef.current?.startReveal();
  }, [revealNonce]);

  const flown = useRef(0);
  useEffect(() => {
    if (!flyTarget || flyTarget.nonce === flown.current) return;
    flown.current = flyTarget.nonce;
    engineRef.current?.flyToFile(flyTarget.file);
  }, [flyTarget]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="map-sky"
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label={label}
        aria-describedby="map-sky-help"
      />
      <p id="map-sky-help" className="sr-only">
        Left and right arrows move between areas or files. Enter opens the one in focus. Escape goes
        back. Shift with arrows pans, plus and minus zoom, 0 fits the map.
      </p>
      <div className="map-zoom map-glass" role="group" aria-label="Zoom" data-map-overlay>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => engineRef.current?.zoomBy(ZOOM_STEP)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => engineRef.current?.zoomBy(1 / ZOOM_STEP)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Fit the whole map"
          onClick={() => engineRef.current?.fitAll()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </>
  );
}
