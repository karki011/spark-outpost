import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import './island-skin.css';
import './island-bubble.css';
import { BlobScout } from '../brand/BlobScout.tsx';
import { setMotionMode } from '../app/idle-motion.ts';
import { useIdleAfter } from '../ui/use-idle-after.ts';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { leaveAsGhost } from './home-motion.ts';
import { viewWidth, type IslandView } from './island-model.ts';
import { useViewportWidth } from './island-parts.tsx';
import { wingsFor } from './island-wings.tsx';
import { keyHint } from './key-hints.tsx';
import { CalendarLineView } from './CalendarRestLine.tsx';
import { scoutLabel, ScoutMarks } from './RestLine.tsx';
import { DropScene } from './DropScene.tsx';
import { ViewBody, type IslandShellProps } from './ShellBody.tsx';
import { notchFit, restLineTop, restPose, restsQuietly, stripHeight } from './island-fit.ts';
import { restMetrics, useIslandHeight, type RestMetrics } from './island-size.ts';
import { useIslandShape, type ScoutSpot } from './use-island-shape.ts';

interface ShellRefs {
  islandRef: RefObject<HTMLDivElement | null>;
}

const KHINT_HEIGHT = 18;
const PANEL_MIN_WIDTH = 320;
const PANEL_SIDE_GAP = 16;
const NOTCH_MARGIN = 8;
const ISLAND_BORDER = 1;
const PEEK_ROW_RISE = 7;
const THREAD = 30;
const SCOUT_FEET = 58 / 64;

function hasCard(view: IslandView): boolean {
  return view.kind === 'card' || view.kind === 'note';
}

function scoutSpot(
  view: IslandView,
  width: number,
  top: number,
  rest: RestMetrics,
  docked: boolean,
  out: boolean,
  height: number,
): ScoutSpot {
  if (view.kind === 'peek') {
    const pose = restPose({ docked, edge: top, tuck: rest.tuck, out, height, blob: rest.blob });
    const x = width / 2 - rest.blob / 2 - ISLAND_BORDER;
    return { x, y: pose.y, size: rest.blob, edge: pose.edge };
  }
  if (hasCard(view)) return { x: 22, y: top + 8 + 14, size: 46 };
  if (view.kind === 'now') return { x: 18, y: top + 9, size: 38 };
  return { x: 10, y: Math.max(2, (top - 22) / 2), size: 22 };
}

function viewKey(view: IslandView): string {
  switch (view.kind) {
    case 'panel':
      return 'panel';
    case 'card':
      return `card-${view.card.approval?.id ?? view.card.chat.id}`;
    default:
      return view.kind;
  }
}

const REST_AFTER_IDLE_MS = 10_000;

export function IslandShell({ islandRef, ...props }: IslandShellProps & ShellRefs) {
  const { view, geometry, size } = props;
  const height = useIslandHeight();
  const scoutRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const fit = notchFit(geometry);
  const { hugsNotch, notchHeight } = fit;
  const flat = geometry.docked && !geometry.notch;
  const peeking = view.kind === 'peek';
  const bare = flat && peeking;
  const loose = !geometry.docked && peeking;
  const rest = restMetrics(size);
  const quiet = peeking;
  const top = bare || loose ? 0 : stripHeight(fit, quiet);
  const out = props.hover || !restsQuietly(props.mood);
  const { docked } = geometry;
  const pose = peeking
    ? restPose({ docked, edge: top, tuck: rest.tuck, out, height, blob: rest.blob })
    : null;
  const gap = hugsNotch ? geometry.notchWidth + 2 * NOTCH_MARGIN : 0;
  const notchSpan = loose ? 0 : view.kind === 'peek' ? geometry.notchWidth : gap;
  const viewport = useViewportWidth();
  const screenWidth = window.screen.width;
  const room = Math.max(PANEL_MIN_WIDTH, viewport - PANEL_SIDE_GAP);
  const width = bare ? rest.blob : Math.min(viewWidth(view, notchSpan, screenWidth), room);
  const hint = keyHint(view);
  const scout = scoutSpot(view, width, top, rest, docked, out, height);
  const setTarget = useIslandShape(
    islandRef,
    scoutRef,
    { width, height: top, radius: 14, scout },
    props.reduced,
  );
  const rowTop = Math.max(top, notchHeight + PEEK_ROW_RISE);
  const threadTop = rest.blob * SCOUT_FEET;
  const lineTop = Math.max(restLineTop(flat, rowTop) - (pose?.y ?? 0), threadTop + THREAD);
  const hanging = peeking && props.calendarLine !== null;
  const wings = wingsFor(props);
  const resting = (quiet || view.kind === 'now') && !props.hover;
  const hidden = usePageHidden();
  const idle = useIdleAfter(REST_AFTER_IDLE_MS);
  const motion = resting || hidden ? 'paused' : idle ? 'rest' : 'live';
  useEffect(() => setMotionMode(motion), [motion]);
  const reducedRef = useRef(props.reduced);
  useEffect(() => {
    reducedRef.current = props.reduced;
  }, [props.reduced]);
  const attachView = useCallback((node: HTMLDivElement | null) => {
    viewRef.current = node;
    if (!node) return;
    return () => {
      if (viewRef.current === node) viewRef.current = null;
      if (!reducedRef.current && node.dataset.panel) leaveAsGhost(node);
    };
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const body = quiet ? 0 : (viewRef.current?.scrollHeight ?? 0);
      const panelHeight = top + body + (hint && !quiet ? KHINT_HEIGHT : 0);
      setTarget(
        {
          width,
          height: panelHeight,
          radius: quiet ? 14 : 22,
          scout: scoutSpot(view, width, top, rest, docked, out, height),
        },
        view.kind === 'peek' ? 0.62 : 0.5,
      );
    };
    measure();
    const watched = viewRef.current;
    if (!watched || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(watched);
    return () => observer.disconnect();
  }, [view, width, top, quiet, hint, setTarget, rest, docked, out, height]);

  const classes = [
    'isl',
    view.kind === 'peek' ? 'peek' : '',
    bare ? 'bare' : '',
    pose?.tucked ? 'tucked' : '',
    flat ? 'hang' : '',
    !quiet ? 'lifted' : '',
    geometry.docked ? '' : 'floating',
  ].filter(Boolean);

  return (
    <div
      className="isl-root"
      data-rm={props.reduced || undefined}
      data-rest={resting || undefined}
      data-hidden={hidden || undefined}
    >
      <div className="sr-only" aria-live="polite">
        {props.announcement}
      </div>
      <div
        ref={islandRef}
        className={classes.join(' ')}
        role="region"
        aria-label="Spark Island"
        data-view={view.kind}
        style={
          {
            '--top': `${top}px`,
            '--gap': `${gap}px`,
            '--wl': hasCard(view) || view.kind === 'now' ? '14px' : '40px',
          } as CSSProperties
        }
      >
        <span className="isl-ear l" aria-hidden="true" />
        <span className="isl-ear r" aria-hidden="true" />
        <div className="isl-clip">
          <div className="isl-toprow">
            <div className="isl-wing l">
              <span className="isl-wlabel">{wings.left}</span>
            </div>
            <div className="isl-gap" />
            <div className="isl-wing r">
              <span className="isl-wr">{wings.right}</span>
            </div>
          </div>
          {!quiet && (
            <div
              ref={attachView}
              key={viewKey(view)}
              className="isl-view"
              data-panel={view.kind === 'panel' ? view.panel : undefined}
              data-drop={props.drop.grab.phase !== 'idle' || undefined}
              style={{ width, marginLeft: -width / 2 }}
            >
              <ViewBody props={props} />
            </div>
          )}
          {hint && !quiet && (
            <div className="isl-khint" aria-hidden="true">
              {hint}
            </div>
          )}
        </div>
        <DropScene {...props.drop} />
        <div
          ref={scoutRef}
          className="isl-scout-wrap"
          data-wave={props.wave || undefined}
          data-edge={pose?.edge ?? undefined}
        >
          {peeking && <ScoutMarks asking={props.asking} setAside={props.setAside} />}
          <span className="isl-glow" data-mood={props.mood ?? 'idle'} aria-hidden="true" />
          <BlobScout mood={props.mood} size={30} lookAtPointer={quiet} />
          <button
            type="button"
            className="isl-scout-btn"
            aria-label={scoutLabel(props.asking, props.setAside)}
            onClick={props.onScout}
          />
          {hanging && (
            <span
              className="isl-thread"
              aria-hidden="true"
              style={
                {
                  '--thread-top': `${threadTop}px`,
                  '--thread-len': `${lineTop - threadTop}px`,
                } as CSSProperties
              }
            />
          )}
          {peeking && props.calendarLine && (
            <CalendarLineView line={props.calendarLine} top={lineTop} calendar={props.calendar} />
          )}
        </div>
      </div>
    </div>
  );
}
