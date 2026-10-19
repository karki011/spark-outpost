import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import { BlobScout } from '../brand/BlobScout.tsx';
import { setMotionMode } from '../app/idle-motion.ts';
import { leaveAsGhost } from './home-motion.ts';
import { chatWidth, peekClearance, viewWidth, type IslandView } from './island-model.ts';
import { useViewportWidth } from './island-parts.tsx';
import { wingsFor } from './island-wings.tsx';
import { keyHint } from './key-hints.tsx';
import { PeekRow } from './PeekRow.tsx';
import { CalendarLineView } from './CalendarRestLine.tsx';
import { RestLine, scoutLabel, ScoutMarks } from './RestLine.tsx';
import { DropScene } from './DropScene.tsx';
import { ViewBody, type IslandShellProps } from './ShellBody.tsx';
import { notchFit, restLineTop, restPose, restsQuietly, stripHeight } from './island-fit.ts';
import { restMetrics, type RestMetrics } from './island-size.ts';
import { useIslandShape, type ScoutSpot } from './use-island-shape.ts';

interface ShellRefs {
  islandRef: RefObject<HTMLDivElement | null>;
  rowRef: RefObject<HTMLDivElement | null>;
}

const KHINT_HEIGHT = 18;
const PANEL_MIN_WIDTH = 320;
const PANEL_SIDE_GAP = 16;
const ROW_BLOB = 22;
const FLAT_ROW_BLOB = 28;
const NOTCH_MARGIN = 8;
const ISLAND_BORDER = 1;
const PEEK_ROW_RISE = 7;

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
): ScoutSpot {
  if (view.kind === 'peek') {
    const pose = restPose({ docked, edge: top, tuck: rest.tuck, out });
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

export function IslandShell({ islandRef, rowRef, ...props }: IslandShellProps & ShellRefs) {
  const { view, geometry, size } = props;
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
  const pose = peeking ? restPose({ docked, edge: top, tuck: rest.tuck, out }) : null;
  const gap = hugsNotch ? geometry.notchWidth + 2 * NOTCH_MARGIN : 0;
  const notchSpan = loose ? 0 : view.kind === 'peek' ? geometry.notchWidth : gap;
  const viewport = useViewportWidth();
  const screenWidth = window.screen.width;
  const room = Math.max(PANEL_MIN_WIDTH, viewport - PANEL_SIDE_GAP);
  const chatting = view.kind === 'panel' && view.panel === 'sessions' && props.selected !== null;
  const width = bare
    ? rest.blob
    : Math.min(chatting ? chatWidth(screenWidth) : viewWidth(view, notchSpan, screenWidth), room);
  const hint = keyHint(view);
  const scout = scoutSpot(view, width, top, rest, docked, out);
  const rowShift = view.kind === 'peek' ? scout.x + scout.size / 2 - width / 2 : 0;
  const setTarget = useIslandShape(
    islandRef,
    scoutRef,
    { width, height: top, radius: 14, scout },
    props.reduced,
  );
  const rowTop = Math.max(top, notchHeight + PEEK_ROW_RISE);
  const lineTop = restLineTop(flat, rowTop) - (pose?.y ?? 0);
  const wings = wingsFor({ ...props, hugsNotch });
  const resting = (quiet || view.kind === 'now') && !props.hover;
  useEffect(() => setMotionMode(resting ? 'paused' : 'live'), [resting]);
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
      const height = top + body + (hint && !quiet ? KHINT_HEIGHT : 0);
      setTarget(
        {
          width,
          height,
          radius: quiet ? 14 : 22,
          scout: scoutSpot(view, width, top, rest, docked, out),
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
  }, [view, width, top, quiet, hint, setTarget, rest, docked, out]);

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
    <div className="isl-root" data-rm={props.reduced || undefined} data-rest={resting || undefined}>
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
          {peeking && props.line && (
            <RestLine key={props.line.key} line={props.line} top={lineTop} onOpen={props.onLine} />
          )}
          {peeking && props.calendarLine && (
            <CalendarLineView line={props.calendarLine} top={lineTop} calendar={props.calendar} />
          )}
        </div>
      </div>
      <div
        ref={rowRef}
        className="isl-peekrow-wrap"
        data-flat={flat || undefined}
        style={{ '--top': `${rowTop}px`, '--cx': `${rowShift}px` } as CSSProperties}
      >
        <PeekRow
          sessions={props.peek.sessions}
          more={props.peek.more}
          shown={quiet}
          size={flat ? FLAT_ROW_BLOB : ROW_BLOB}
          clearance={peekClearance(flat, rest.blob)}
          sleepy={props.sleepy}
          onOpen={props.onPeekOpen}
          onMore={() => props.onTab('sessions')}
        />
      </div>
    </div>
  );
}
