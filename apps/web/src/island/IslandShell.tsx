import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import { BlobScout } from '../brand/BlobScout.tsx';
import { leaveAsGhost } from './home-motion.ts';
import { viewWidth, type IslandView } from './island-model.ts';
import { useViewportWidth } from './island-parts.tsx';
import { wingsFor } from './island-wings.tsx';
import { keyHint } from './key-hints.tsx';
import { PeekRow } from './PeekRow.tsx';
import { DropScene } from './DropScene.tsx';
import { ViewBody, type IslandShellProps } from './ShellBody.tsx';
import { restMetrics, type RestMetrics } from './island-size.ts';
import { useIslandShape, type ScoutSpot } from './use-island-shape.ts';

interface ShellRefs {
  islandRef: RefObject<HTMLDivElement | null>;
  rowRef: RefObject<HTMLDivElement | null>;
}

const KHINT_HEIGHT = 18;
const PILL_MIN_WIDTH = 112;
const PANEL_MIN_WIDTH = 320;
const CHAT_WIDTH = 690;
const PANEL_SIDE_GAP = 16;
const ROW_BLOB = 22;
const FLAT_ROW_BLOB = 28;

function hasCard(view: IslandView): boolean {
  return view.kind === 'card' || view.kind === 'note';
}

function scoutSpot(
  view: IslandView,
  width: number,
  top: number,
  hang: number | null,
  rest: RestMetrics,
): ScoutSpot {
  if (hang !== null) return { x: width / 2 - rest.blob / 2, y: -hang, size: rest.blob };
  if (view.kind === 'peek') return { x: width / 2 - 9, y: top - 13, size: 30 };
  if (hasCard(view)) return { x: 22, y: top + 8 + 14, size: 46 };
  if (view.kind === 'nudge') {
    return { x: 10, y: Math.max(2, (top - rest.pillScout) / 2), size: rest.pillScout };
  }
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
  const wingRef = useRef<HTMLSpanElement>(null);
  const hugsNotch = geometry.notch && geometry.docked;
  const flat = geometry.docked && !geometry.notch;
  const bare = flat && view.kind === 'peek';
  const rest = restMetrics(size);
  const hang = bare ? rest.tuck : null;
  const pillish = view.kind === 'nudge';
  const top = pillish ? Math.max(geometry.top, rest.pillHeight) : bare ? 0 : geometry.top;
  const quiet = view.kind === 'peek' || pillish;
  const viewport = useViewportWidth();
  const room = Math.max(PANEL_MIN_WIDTH, viewport - PANEL_SIDE_GAP);
  const chatting = view.kind === 'panel' && view.panel === 'sessions' && props.selected !== null;
  const width = bare
    ? rest.blob
    : Math.min(chatting ? CHAT_WIDTH : viewWidth(view, geometry.notchWidth), room);
  const compactPill = pillish && !hugsNotch;
  const hint = keyHint(view);
  const setTarget = useIslandShape(
    islandRef,
    scoutRef,
    { width, height: top, radius: 14, scout: scoutSpot(view, width, top, hang, rest) },
    props.reduced,
  );
  const wings = wingsFor(props);
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
      const fitted = compactPill
        ? Math.max(PILL_MIN_WIDTH, rest.pillInset + (wingRef.current?.scrollWidth ?? 0))
        : width;
      setTarget(
        {
          width: fitted,
          height,
          radius: pillish ? 16 : quiet ? 14 : 22,
          scout: scoutSpot(view, fitted, top, hang, rest),
        },
        view.kind === 'peek' ? 0.62 : 0.5,
      );
    };
    measure();
    const watched = [viewRef.current, compactPill ? wingRef.current : null].filter(
      (element) => element !== null,
    );
    if (watched.length === 0 || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    watched.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [view, width, top, quiet, hint, compactPill, hang, pillish, setTarget, rest]);

  const classes = [
    'isl',
    view.kind === 'peek' ? 'peek' : '',
    bare ? 'bare' : '',
    flat ? 'hang' : '',
    !quiet ? 'lifted' : '',
    geometry.docked ? '' : 'floating',
  ].filter(Boolean);

  return (
    <div
      className="isl-root"
      data-rm={props.reduced || undefined}
      data-rest={(quiet && !props.hover) || undefined}
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
            '--gap': `${hugsNotch ? geometry.notchWidth : 0}px`,
            '--wl': hasCard(view) ? '14px' : `${pillish ? rest.pillWing : 40}px`,
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
              <span ref={wingRef} className="isl-wr">
                {wings.right}
              </span>
            </div>
          </div>
          {!quiet && (
            <div
              ref={attachView}
              key={viewKey(view)}
              className="isl-view"
              data-panel={view.kind === 'panel' ? view.panel : undefined}
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
        <div ref={scoutRef} className="isl-scout-wrap" data-wave={props.wave || undefined}>
          {props.waiting > 0 && view.kind === 'peek' && (
            <span className="isl-pbadge" aria-hidden="true">
              {props.waiting}
            </span>
          )}
          <span className="isl-glow" data-mood={props.mood ?? 'idle'} aria-hidden="true" />
          <BlobScout mood={props.mood} size={30} lookAtPointer={quiet} />
          <button
            type="button"
            className="isl-scout-btn"
            aria-label={
              props.waiting > 0
                ? `Spark: ${props.waiting} need you. Open Spark Island`
                : 'Open Spark Island'
            }
            onClick={props.onScout}
          />
        </div>
      </div>
      <div
        ref={rowRef}
        className="isl-peekrow-wrap"
        data-flat={flat || undefined}
        style={{ '--top': `${top}px` } as CSSProperties}
      >
        <PeekRow
          sessions={props.peek.sessions}
          more={props.peek.more}
          shown={quiet}
          size={flat ? FLAT_ROW_BLOB : ROW_BLOB}
          sleepy={props.sleepy}
          onOpen={props.onPeekOpen}
          onMore={() => props.onTab('sessions')}
        />
      </div>
    </div>
  );
}
