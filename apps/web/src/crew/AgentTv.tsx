import './agent-tv.css';
import './agent-tv-stage.css';
import 'blobatar/gaze.css';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { useReducedMotion } from '../ui/motion.ts';
import { useTooltip } from '../ui/Tooltip.tsx';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import {
  clearTvFinished,
  closeAgentTv,
  moveAgentTv,
  resizeAgentTv,
  setTvMuted,
  setTvView,
  setTvWatch,
  TV_SIZES,
  useAgentTv,
  type TvSize,
  type TvView,
} from './agent-tv-store.ts';
import { AgentTvStage } from './AgentTvStage.tsx';
import type { CrewAgent } from './crew-model.ts';
import { ChatterIcon, ListIcon, StageIcon, WatchIcon } from './tv-icons.tsx';
import { TvList } from './TvList.tsx';
import type { TvRows } from './tv-list.ts';
import { tvCaption } from './tv-caption.ts';
import { StageGaze } from './tv-gaze.ts';
import type { PieceTag } from './tv-coordinator.ts';
import { clampToViewport, hubStage, STAGES, watchStage } from './tv-layout.ts';
import type { TvAsk } from './tv-scene.ts';
import { useThrottledText, useViewport } from './use-tv-env.ts';
import { useTvEvents } from './use-tv-events.ts';

export const TV_BUTTON_ID = 'agent-tv-button';

const CAPTION_THROTTLE_MS = 2500;
const SIZE_OPTIONS = TV_SIZES.map((id) => ({ id, label: id.toUpperCase() }));
const VIEW_OPTIONS = [
  {
    id: 'stage',
    label: (
      <>
        <StageIcon />
        <span className="sr-only">Stage</span>
      </>
    ),
  },
  {
    id: 'list',
    label: (
      <>
        <ListIcon />
        <span className="sr-only">List</span>
      </>
    ),
  },
];

function isNarrow(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
}

function focusButton() {
  document.getElementById(TV_BUTTON_ID)?.focus();
}

interface AgentTvProps {
  members: readonly CrewAgent[];
  asks: Record<string, TvAsk>;
  decision: string | null;
  remark: string | null;
  rows: TvRows;
  tags?: Record<string, PieceTag> | null;
  stopping: string | null;
  onPick(id: string): void;
  onAsk(approvalId: string): void;
  onStop(runId: string): void;
  branch?: string | null;
}

export function AgentTv({
  members,
  asks,
  decision,
  remark,
  rows,
  tags = null,
  stopping,
  onPick,
  onAsk,
  onStop,
  branch = null,
}: AgentTvProps) {
  const { position, size, watch, muted, view, cleared } = useAgentTv();
  const panel = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const hidden = usePageHidden();
  const viewport = useViewport();
  const gaze = useMemo(() => (reduced ? null : new StageGaze()), [reduced]);
  const events = useTvEvents(
    { agents: members, decision: remark },
    { muted, reduced, paused: hidden, asking: Object.keys(asks) },
  );
  const caption = tvCaption(members);
  const captionText = [caption.lead, caption.text].filter(Boolean).join(': ');
  const spoken = useThrottledText(captionText, CAPTION_THROTTLE_MS);
  const narrow = viewport.width <= 640;
  const baseMetrics = watch ? watchStage(viewport) : STAGES[narrow ? 's' : size];
  const metrics = tags ? hubStage(baseMetrics) : baseMetrics;
  const viewTip = useTooltip(view === 'list' ? 'List view' : 'Stage view');
  const sizeTip = useTooltip('Small / Medium / Large TV');
  const muteTip = useTooltip(muted ? 'Show speech bubbles' : 'Mute speech bubbles');
  const watchTip = useTooltip(watch ? 'Leave watch mode' : 'Watch mode');
  const closeTip = useTooltip('Close Agent TV (Esc)');

  useEffect(() => {
    gaze?.pause(hidden);
  }, [gaze, hidden]);

  useEffect(() => () => gaze?.stop(), [gaze]);

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (selected) {
        setSelected(null);
        return;
      }
      if (watch) {
        setTvWatch(false);
        return;
      }
      closeAgentTv();
      focusButton();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, watch]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    if (!position || watch || isNarrow()) {
      Object.assign(element.style, { left: '', top: '', right: '', bottom: '' });
      return;
    }
    const next = clampToViewport(
      position,
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: innerWidth, height: innerHeight },
    );
    Object.assign(element.style, {
      left: `${next.x}px`,
      top: `${next.y}px`,
      right: 'auto',
      bottom: 'auto',
    });
  }, [position, size, watch, view, viewport.width, viewport.height]);

  const close = () => {
    closeAgentTv();
    focusButton();
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const element = panel.current;
    const target = event.target as HTMLElement;
    if (!element || watch || isNarrow() || target.closest('button, [role="radiogroup"]')) return;
    const box = element.getBoundingClientRect();
    const offset = { x: event.clientX - box.left, y: event.clientY - box.top };
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) =>
      moveAgentTv({ x: moveEvent.clientX - offset.x, y: moveEvent.clientY - offset.y });
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const redock = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    if (!watch) moveAgentTv(null);
  };

  const classes = [
    'tv',
    `size-${size}`,
    `view-${view}`,
    watch && 'watch',
    hidden && 'paused',
    reduced && 'still',
  ];

  return createPortal(
    <>
      {watch && <div className="tv-dim" aria-hidden="true" onClick={() => setTvWatch(false)} />}
      <div
        ref={panel}
        className={classes.filter(Boolean).join(' ')}
        role="dialog"
        aria-label="Agent TV"
        tabIndex={-1}
      >
        <div className="tv-h" onPointerDown={startDrag} onDoubleClick={redock}>
          <i className="tv-live" aria-hidden="true" />
          <span
            className="tv-title"
            title={watch ? undefined : 'Drag to move. Double-click to dock'}
          >
            <span>
              Agent TV <small>live</small>
            </span>
            {branch && (
              <small className="tv-branch" title={branch}>
                · {branch}
              </small>
            )}
          </span>
          <span className="tv-view" {...viewTip.triggerProps}>
            <Segmented
              ariaLabel="Agent TV view"
              options={VIEW_OPTIONS}
              value={view}
              onChange={(id) => setTvView(id as TvView)}
            />
          </span>
          {!watch && (
            <span className="tv-size" {...sizeTip.triggerProps}>
              <Segmented
                ariaLabel="Agent TV size"
                options={SIZE_OPTIONS}
                value={size}
                onChange={(id) => resizeAgentTv(id as TvSize)}
              />
            </span>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label="Mute speech bubbles"
            aria-pressed={muted}
            {...muteTip.triggerProps}
            onClick={() => setTvMuted(!muted)}
          >
            <ChatterIcon muted={muted} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Watch mode"
            aria-pressed={watch}
            {...watchTip.triggerProps}
            onClick={() => setTvWatch(!watch)}
          >
            <WatchIcon on={watch} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close Agent TV"
            aria-keyshortcuts="Escape"
            {...closeTip.triggerProps}
            onClick={close}
          >
            <CloseIcon />
          </button>
          {viewTip.tooltip}
          {sizeTip.tooltip}
          {muteTip.tooltip}
          {watchTip.tooltip}
          {closeTip.tooltip}
        </div>
        {view === 'list' ? (
          <TvList
            rows={rows}
            cleared={cleared}
            stopping={stopping}
            onPick={onPick}
            onAsk={onAsk}
            onStop={onStop}
            onClear={clearTvFinished}
          />
        ) : (
          <AgentTvStage
            members={members}
            metrics={metrics}
            asks={asks}
            decision={decision}
            chatter={events.chatter}
            packets={events.packets}
            gaze={gaze}
            tags={tags}
            reduced={reduced}
            selected={selected}
            onSelect={setSelected}
            onLanded={events.landed}
            onPick={onPick}
            onAsk={onAsk}
          />
        )}
        {view === 'stage' && (
          <p className="tv-cap" aria-hidden="true">
            {caption.lead && <b>{caption.lead}</b>} {caption.text}
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {spoken}
        </p>
      </div>
    </>,
    document.body,
  );
}
