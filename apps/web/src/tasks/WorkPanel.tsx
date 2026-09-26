import './task-card.css';
import '../ui/panel-motion.css';
import './work-panel.css';
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  isTerminalRunStatus,
  type Orchestration,
  type Run,
  type TaskOverview,
} from '@spark-outpost/contracts';
import type { CrewAgent } from '../crew/crew-model.ts';
import { ShieldIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { ChangesPane } from './ChangesPane.tsx';
import { CostPane } from './CostPane.tsx';
import { CrewPane } from './CrewPane.tsx';
import { LinksPane } from './LinksPane.tsx';
import { PlanPane } from './PlanPane.tsx';
import { taskApi, taskKeys } from './task-api.ts';
import { progressPercent } from './TaskCard.tsx';
import { CloseIcon } from './TaskIcons.tsx';
import { TaskList, WaitingItems } from './TaskList.tsx';
import { WORK_PANEL_DEFAULT_WIDTH } from './work-panel-state.ts';
import { WorkPanelResizer } from './WorkPanelResizer.tsx';

export type WorkTab = 'tasks' | 'plan' | 'crew' | 'links' | 'changes' | 'cost';

const tabNames: Record<WorkTab, string> = {
  tasks: 'Tasks',
  plan: 'Plan',
  crew: 'Crew',
  links: 'Links',
  changes: 'Changes',
  cost: 'Cost',
};

function statusPill(task: TaskOverview): { className: string; label: string } {
  if (task.summary.waiting > 0) return { className: 'spill rev', label: 'Needs you' };
  if (task.items.some((item) => item.state === 'active')) {
    return { className: 'spill prog', label: 'Working' };
  }
  const lastRun = task.items.findLast((item) => item.id.startsWith('run:'));
  if (lastRun?.state === 'failed') return { className: 'spill bad', label: 'Stopped' };
  return { className: 'spill ok', label: 'Done' };
}

function orchestrationPill(
  orchestration: Orchestration,
  task: TaskOverview,
): { className: string; label: string } {
  if (task.summary.waiting > 0) return { className: 'spill rev', label: 'Needs you' };
  if (orchestration.status === 'succeeded') return { className: 'spill ok', label: 'Done' };
  if (isTerminalRunStatus(orchestration.status))
    return { className: 'spill bad', label: 'Stopped' };
  return { className: 'spill prog', label: 'Working' };
}

interface WorkPanelProps {
  conversationId: string;
  task: TaskOverview;
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
}

export function WorkPanel({
  conversationId,
  task,
  open,
  wide,
  tab,
  onTab: setTab,
  onClose,
  onAudit,
  orchestration = null,
  agents = [],
  roots = [],
  runs = [],
  width = null,
  onWidth,
}: WorkPanelProps) {
  const items = task.items;
  const heading = useRef<HTMLHeadingElement>(null);
  const closeTip = useTooltip('Hide work panel');
  const detail = useQuery({
    queryKey: taskKeys.task(task.id),
    queryFn: () => taskApi.get(task.id),
    enabled: open,
  });
  const tabs: WorkTab[] = task.planVersion
    ? ['tasks', 'plan', 'crew', 'links', 'changes', 'cost']
    : ['tasks', 'crew', 'links', 'changes', 'cost'];
  const current = tabs.includes(tab) ? tab : 'tasks';
  const pill = orchestration ? orchestrationPill(orchestration, task) : statusPill(task);

  useEffect(() => {
    if (open && !wide) heading.current?.focus();
  }, [open, wide]);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = tabs[(tabs.indexOf(current) + step + tabs.length) % tabs.length]!;
    setTab(next);
    document.getElementById(`wtab-${next}`)?.focus();
  };

  return (
    <>
      {!wide && (
        <div className={open ? 'wp-scrim on' : 'wp-scrim'} aria-hidden="true" onClick={onClose} />
      )}
      <aside
        className={open ? 'wp on' : 'wp'}
        id="work-panel"
        aria-label="Work panel"
        inert={!open}
        style={{ '--wp-w': `${width ?? WORK_PANEL_DEFAULT_WIDTH}px` } as CSSProperties}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !wide) onClose();
        }}
      >
        {wide && open && onWidth && <WorkPanelResizer width={width} onWidth={onWidth} />}
        <div className="wp-in">
          <span className="wp-grab" aria-hidden="true" />
          <div className="wp-head">
            <b>Work</b>
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
          <div className="wp-body">
            <WaitingItems items={items} roots={roots} {...(wide ? {} : { onReview: onClose })} />
            <section className="wtask">
              <div className="wt-h">
                <h2 ref={heading} tabIndex={-1}>
                  {task.title}
                </h2>
                <span className={pill.className}>{pill.label}</span>
              </div>
              <p className="wprog">{task.summary.text}</p>
              <div
                className="wbar"
                role="progressbar"
                aria-label="Task progress"
                aria-valuemin={0}
                aria-valuemax={task.summary.total}
                aria-valuenow={task.summary.done}
              >
                <i style={{ transform: `scaleX(${progressPercent(task) / 100})` }} />
              </div>
            </section>
            <div className="wtabs" role="tablist" aria-label="Task details">
              {tabs.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`wtab-${id}`}
                  aria-selected={current === id}
                  aria-controls="wpane"
                  tabIndex={current === id ? 0 : -1}
                  onClick={() => setTab(id)}
                  onKeyDown={onTabKey}
                >
                  {tabNames[id]}
                </button>
              ))}
            </div>
            <div className="wpane" id="wpane" role="tabpanel" aria-labelledby={`wtab-${current}`}>
              {current === 'tasks' && <TaskList items={items} roots={roots} />}
              {current === 'crew' && agents.length > 0 && <CrewPane runs={[]} agents={agents} />}
              {current !== 'tasks' &&
                current !== 'changes' &&
                !(current === 'crew' && agents.length > 0) &&
                !detail.data && (
                  <p className="wsec wnote">{detail.isError ? detail.error.message : 'Loading…'}</p>
                )}
              {current === 'plan' && detail.data && (
                <PlanPane
                  taskId={task.id}
                  versions={detail.data.planVersions}
                  runs={detail.data.runs}
                />
              )}
              {current === 'links' && detail.data && (
                <LinksPane
                  taskId={task.id}
                  conversationId={conversationId}
                  links={detail.data.links}
                />
              )}
              {current === 'crew' && agents.length === 0 && detail.data && (
                <CrewPane runs={detail.data.runs} />
              )}
              {current === 'changes' && (
                <ChangesPane taskId={task.id} runs={detail.data?.runs ?? []} />
              )}
              {current === 'cost' && detail.data && (
                <CostPane task={detail.data} runs={runs} agents={agents} onAudit={onAudit} />
              )}
            </div>
          </div>
          {onAudit && (
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
