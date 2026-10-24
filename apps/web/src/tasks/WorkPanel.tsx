import './task-card.css';
import '../ui/panel-motion.css';
import './work-panel.css';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { InvolvementLevel, Orchestration, Run, TaskOverview } from '@spark-outpost/contracts';
import type { CrewAgent } from '../crew/crew-model.ts';
import { GlobeIcon } from '../browser/BrowserIcons.tsx';
import { ArtifactIcon, ShieldIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { AdoptPullSection } from './AdoptPullSection.tsx';
import { AutonomySection } from './AutonomySection.tsx';
import { AgentsSection } from '../chat/subagents/AgentsSection.tsx';
import { TerminalWork } from '../terminal/usage/TerminalWork.tsx';
import { TaskDetails, type WorkTab } from './TaskDetails.tsx';
import { CloseIcon, PanelIcon } from './TaskIcons.tsx';
import type { PanelWidthLimits } from '../ui/panel-width.ts';
import { WORK_PANEL_LIMITS, type PanelView } from './work-panel-state.ts';
import { WorkPanelResizer } from './WorkPanelResizer.tsx';
import { PaneResizer } from '../browser/PaneResizer.tsx';
import { usePhone } from '../ui/breakpoints.ts';

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
  artifact?: { title: string; render: (chrome: PanelChrome) => ReactNode } | null;
  terminal?: boolean;
}

export interface PanelChrome {
  views: ReactNode;
  close: ReactNode;
  setWidth: ((width: number) => void) | null;
}

interface PanelTab {
  id: PanelView;
  name: string;
}

const VIEW_ICONS: Record<PanelView, ReactNode> = {
  work: <PanelIcon />,
  browser: <GlobeIcon />,
  artifact: <ArtifactIcon />,
};

interface ViewSwitchProps {
  tabs: readonly PanelTab[];
  view: PanelView;
  onView(view: PanelView): void;
}

function ViewTab({ tab, view, onView }: { tab: PanelTab } & Omit<ViewSwitchProps, 'tabs'>) {
  const tip = useTooltip(tab.name);
  return (
    <>
      <button
        type="button"
        role="tab"
        aria-label={tab.name}
        aria-selected={view === tab.id}
        aria-controls="work-panel"
        tabIndex={view === tab.id ? 0 : -1}
        {...tip.triggerProps}
        onClick={() => onView(tab.id)}
      >
        {VIEW_ICONS[tab.id]}
      </button>
      {tip.tooltip}
    </>
  );
}

function ViewSwitch({ tabs, view, onView }: ViewSwitchProps) {
  return (
    <div
      className="wp-switch"
      role="tablist"
      aria-label="Panel"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const at = tabs.findIndex((tab) => tab.id === view);
        const next = (at + step + tabs.length) % tabs.length;
        onView(tabs[next]!.id);
        event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
      }}
    >
      {tabs.map((tab) => (
        <ViewTab key={tab.id} tab={tab} view={view} onView={onView} />
      ))}
    </div>
  );
}

function panelTabs(hasWork: boolean, browser: boolean, artifact: string | null): PanelTab[] {
  return [
    ...(hasWork ? [{ id: 'work' as const, name: 'Work' }] : []),
    ...(browser ? [{ id: 'browser' as const, name: 'Browser' }] : []),
    ...(artifact !== null ? [{ id: 'artifact' as const, name: artifact }] : []),
  ];
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
  artifact = null,
  terminal = false,
}: WorkPanelProps) {
  const hasWork = task !== null || autonomy !== null || terminal;
  const browsing = browser !== null && view === 'browser';
  const reading = artifact !== null && view === 'artifact';
  const wideView = browsing || reading;
  const tabs = panelTabs(hasWork, browser !== null, artifact?.title ?? null);
  const phone = usePhone();
  const resizable = open && onWidth !== undefined && (wide || (wideView && !phone));
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

  const views = tabs.length > 1 && onView && <ViewSwitch tabs={tabs} view={view} onView={onView} />;
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
        className={`wp${open ? ' on' : ''}${wide ? '' : ' over'}${wideView ? ' browser' : ''}`}
        id="work-panel"
        aria-label="Work panel"
        data-chat-links=""
        inert={!open}
        style={{ '--wp-w': `${width ?? limits.fallback}px` } as CSSProperties}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !wide) onClose();
        }}
      >
        {resizable && wideView && (
          <PaneResizer
            key={view}
            label={browsing ? 'Resize browser pane' : 'Resize work panel'}
            width={width}
            limits={limits}
            onWidth={onWidth}
          />
        )}
        {resizable && !wideView && (
          <WorkPanelResizer width={width} onWidth={onWidth} limits={limits} />
        )}
        <div className="wp-in">
          <span className="wp-grab" aria-hidden="true" />
          {!wideView && (
            <div className="wp-head">
              {views}
              <b ref={title} tabIndex={-1}>
                Work
              </b>
              {close}
            </div>
          )}
          <div className={wideView ? 'wp-body browser' : 'wp-body'}>
            {!wideView && <AgentsSection />}
            {!wideView && !terminal && <AdoptPullSection conversationId={conversationId} />}
            {reading ? (
              artifact.render({ views, close, setWidth: null })
            ) : browsing ? (
              browser({ views, close, setWidth: resizable ? onWidth : null })
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
                terminal={terminal}
              />
            ) : terminal ? (
              <TerminalWork conversationId={conversationId} />
            ) : (
              autonomySection
            )}
          </div>
          {onAudit && !wideView && (
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
