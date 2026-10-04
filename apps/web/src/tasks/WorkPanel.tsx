import './task-card.css';
import '../ui/panel-motion.css';
import './work-panel.css';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { InvolvementLevel, Orchestration, Run, TaskOverview } from '@spark-outpost/contracts';
import type { CrewAgent } from '../crew/crew-model.ts';
import { ShieldIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { AutonomySection } from './AutonomySection.tsx';
import { TaskDetails, type WorkTab } from './TaskDetails.tsx';
import { CloseIcon } from './TaskIcons.tsx';
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
  browser?: ReactNode;
}

const VIEW_NAMES: Record<PanelView, string> = { work: 'Work', browser: 'Browser' };

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
  const views: PanelView[] = browser ? (hasWork ? ['work', 'browser'] : ['browser']) : [];
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

  return (
    <>
      {!wide && (
        <div className={open ? 'wp-scrim on' : 'wp-scrim'} aria-hidden="true" onClick={onClose} />
      )}
      <aside
        className={`wp${open ? ' on' : ''}${browsing ? ' browser' : ''}`}
        id="work-panel"
        aria-label="Work panel"
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
          <div className="wp-head">
            {views.length > 0 ? (
              <div className="wp-views" role="tablist" aria-label="Panel">
                {views.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={view === id}
                    onClick={() => onView?.(id)}
                  >
                    {VIEW_NAMES[id]}
                  </button>
                ))}
              </div>
            ) : (
              <b ref={title} tabIndex={-1}>
                Work
              </b>
            )}
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
          </div>
          <div className={browsing ? 'wp-body browser' : 'wp-body'}>
            {browsing ? (
              browser
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
