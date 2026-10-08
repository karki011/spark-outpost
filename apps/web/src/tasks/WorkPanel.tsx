import './task-card.css';
import '../ui/panel-motion.css';
import './work-panel.css';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { InvolvementLevel, Orchestration, Run, TaskOverview } from '@spark-outpost/contracts';
import type { CrewAgent } from '../crew/crew-model.ts';
import { GlobeIcon } from '../browser/BrowserIcons.tsx';
import { ShieldIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { AutonomySection } from './AutonomySection.tsx';
import { TaskDetails, type WorkTab } from './TaskDetails.tsx';
import { CloseIcon, PanelIcon } from './TaskIcons.tsx';
import { WORK_PANEL_LIMITS, type PanelView, type PanelWidthLimits } from './work-panel-state.ts';
import { WorkPanelResizer } from './WorkPanelResizer.tsx';

interface AutonomySetting {
  level: InvolvementLevel;
  focusRequest: number;
}

interface WorkPanelProps {
  conversationId: string;
  task: TaskOverview | null;
  autonomy: AutonomySetting | null;
  open: boolean;
  wide: boolean;
  tab: WorkTab;
  onTab(tab: WorkTab): void;
  onClose(): void;
  onAudit?: () => void;
  orchestration?: Orchestration | null;
  agents?: readonly CrewAgent[];
  roots?: readonly string[];
  runs?: readonly Run[];
  width?: number | null;
  onWidth?: (width: number | null) => void;
  limits?: PanelWidthLimits;
  view?: PanelView;
  onView?: (view: PanelView) => void;
  browser?: ((chrome: PanelChrome) => ReactNode) | null;
}

export interface PanelChrome {
  views: ReactNode;
  close: ReactNode;
}

const VIEW_NAMES: Record<PanelView, string> = { work: 'Work', browser: 'Browser' };

interface ViewSwitchProps {
  view: PanelView;
  onView(view: PanelView): void;
}

function ViewTab({ id, view, onView }: ViewSwitchProps & { id: PanelView }) {
  const tip = useTooltip(VIEW_NAMES[id]);
  return (
    <>
      <button
        type="button"
        role="tab"
        aria-label={VIEW_NAMES[id]}
        aria-selected={view === id}
        aria-controls="work-panel"
        tabIndex={view === id ? 0 : -1}
        {...tip.triggerProps}
        onClick={() => onView(id)}
      >
        {id === 'work' ? <PanelIcon /> : <GlobeIcon />}
      </button>
      {tip.tooltip}
    </>
  );
}

function ViewSwitch({ view, onView }: ViewSwitchProps) {
  const other: PanelView = view === 'work' ? 'browser' : 'work';
  return (
    <div
      className="wp-switch"
      role="tablist"
      aria-label="Panel"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        onView(other);
        const tabs = event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
        tabs[other === 'work' ? 0 : 1]?.focus();
      }}
    >
      <ViewTab id="work" view={view} onView={onView} />
      <ViewTab id="browser" view={view} onView={onView} />
    </div>
  );
}

export function WorkPanel({
  conversationId,
  task,
  autonomy,
  open,
  wide,
  tab,
  onTab,
  onClose,
  onAudit,
  orchestration = null,
  agents = [],
  roots = [],
  runs = [],
  width = null,
  onWidth,
  limits = WORK_PANEL_LIMITS,
  view = 'work',
  onView,
  browser = null,
}: WorkPanelProps) {
  const hasWork = task !== null || autonomy !== null;
  const browsing = browser !== null && view === 'browser';
  const heading = useRef<HTMLHeadingElement>(null);
  const title = useRef<HTMLElement>(null);
  const closeTip = useTooltip('Hide work panel');

  useEffect(() => {
    if (open && !wide) (heading.current ?? title.current)?.focus();
  }, [open, wide]);

  const autonomySection = autonomy && (
    <AutonomySection
      conversationId={conversationId}
      level={autonomy.level}
      initiallyOpen={task === null}
      focusRequest={autonomy.focusRequest}
    />
  );

  const views = browser !== null && hasWork && onView && <ViewSwitch view={view} onView={onView} />;
  const close = (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="Hide work panel"
        {...closeTip.triggerProps}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
      {closeTip.tooltip}
    </>
  );

  return (
    <>
      {!wide && (
        <div className={open ? 'wp-scrim on' : 'wp-scrim'} aria-hidden="true" onClick={onClose} />
      )}
      <aside
        className={`wp${open ? ' on' : ''}${wide ? '' : ' over'}${browsing ? ' browser' : ''}`}
        id="work-panel"
        aria-label="Work panel"
        data-chat-links=""
        inert={!open}
        style={{ '--wp-w': `${width ?? limits.fallback}px` } as CSSProperties}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !wide) onClose();
        }}
      >
        {wide && open && onWidth && (
          <WorkPanelResizer width={width} onWidth={onWidth} limits={limits} />
        )}
        <div className="wp-in">
          <span className="wp-grab" aria-hidden="true" />
          {!browsing && (
            <div className="wp-head">
              {views}
              <b ref={title} tabIndex={-1}>
                Work
              </b>
              {close}
            </div>
          )}
          <div className={browsing ? 'wp-body browser' : 'wp-body'}>
            {browsing ? (
              browser({ views, close })
            ) : task ? (
              <TaskDetails
                conversationId={conversationId}
                task={task}
                open={open}
                wide={wide}
                tab={tab}
                onTab={onTab}
                onClose={onClose}
                onAudit={onAudit}
                orchestration={orchestration}
                agents={agents}
                roots={roots}
                runs={runs}
                heading={heading}
                autonomy={autonomySection}
              />
            ) : (
              autonomySection
            )}
          </div>
          {onAudit && !browsing && (
            <div className="wp-foot">
              <button type="button" className="btn ghost sm" onClick={onAudit}>
                <ShieldIcon />
                Audit this session
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
