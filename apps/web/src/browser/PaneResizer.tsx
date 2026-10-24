import './pane-width.css';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { PanelResizer } from '../ui/PanelResizer.tsx';
import type { PanelWidthLimits } from '../ui/panel-width.ts';
import { usePaneRoom } from './pane-room.ts';
import { PANE_BIG_STEP, PANE_STEP, paneRange, shownPaneWidth } from './pane-width.ts';

const READOUT_MS = 1200;
const READOUT_GAP = 8;
const READOUT_ROOM = 96;

interface PaneResizerProps {
  label: string;
  width: number | null;
  limits: PanelWidthLimits;
  onWidth(width: number | null): void;
}

const panelTargets = (panel: HTMLElement) => [
  panel,
  ...panel.querySelectorAll<HTMLElement>(':scope > .wp-in'),
];

function readoutStyle(handle: HTMLElement | null): CSSProperties {
  if (!handle) return { display: 'none' };
  const rect = handle.getBoundingClientRect();
  if (rect.left < READOUT_ROOM)
    return { left: rect.right + READOUT_GAP, top: rect.top + READOUT_GAP };
  return {
    right: window.innerWidth - rect.left + READOUT_GAP,
    top: rect.top + rect.height / 2,
    transform: 'translateY(-50%)',
  };
}

interface Readout {
  page: number;
  style: CSSProperties;
}

function useReadout(handle: RefObject<HTMLElement | null>) {
  const [readout, setReadout] = useState<Readout | null>(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (page: number) => {
    setReadout({ page, style: readoutStyle(handle.current) });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setReadout(null), READOUT_MS);
  };
  return [readout, show] as const;
}

export function PaneResizer({ label, width, limits, onWidth }: PaneResizerProps) {
  const handle = useRef<HTMLDivElement>(null);
  const { range, inset } = usePaneRoom(handle, {
    range: paneRange(limits.max, 0),
    inset: 0,
  });
  const shown = shownPaneWidth(width ?? limits.fallback, range);
  const [readout, showPage] = useReadout(handle);
  const pageOf = (pane: number) => pane - inset;
  const changed = useRef(width);

  useEffect(() => {
    if (changed.current === width) return;
    changed.current = width;
    showPage(pageOf(shown));
  });

  return (
    <>
      <PanelResizer
        className="wp-resize"
        label={label}
        panelSelector=".wp"
        variable="--wp-w"
        cap="--wp-cap"
        side="left"
        limits={{ ...limits, min: range.min, max: range.max }}
        width={shown}
        onWidth={(next) => onWidth(next === null ? null : shownPaneWidth(next, range))}
        targets={panelTargets}
        steps={{ step: PANE_STEP, big: PANE_BIG_STEP }}
        value={pageOf}
        text={(pane) => `Page ${pageOf(pane)} pixels wide. Arrow keys resize, Enter resets.`}
        onPaint={(pane) => showPage(pageOf(pane))}
        handleRef={handle}
      />
      {readout &&
        createPortal(
          <span className="bp-width" aria-hidden="true" style={readout.style}>
            {readout.page} px
          </span>,
          document.body,
        )}
    </>
  );
}
