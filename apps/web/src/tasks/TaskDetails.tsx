import { useQuery } from '@tanstack/react-query';
import type { KeyboardEvent, ReactNode, Ref } from 'react';
import {
  isTerminalRunStatus,
  type Orchestration,
  type Run,
  type TaskOverview,
} from '@spark-outpost/contracts';
import type { CrewAgent } from '../crew/crew-model.ts';
import { pieceLabels } from '../crew/piece-labels.ts';
import { ChangesPane } from './ChangesPane.tsx';
import { CostPane } from './CostPane.tsx';
import { CrewPane } from './CrewPane.tsx';
import { LinksPane } from './LinksPane.tsx';
import { PlanPane } from './PlanPane.tsx';
import { taskApi, taskKeys } from './task-api.ts';
import { progressPercent } from './TaskCard.tsx';
import { TaskList, WaitingItems } from './TaskList.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton, type SkeletonShape } from '../ui/loading/Skeleton.tsx';

export type WorkTab = 'tasks' | 'plan' | 'crew' | 'links' | 'changes' | 'cost';

const PANE_SHAPES: Record<WorkTab, SkeletonShape> = {
  tasks: 'list',
  plan: 'lines',
  crew: 'list',
  links: 'list',
  changes: 'list',
  cost: 'cards',
};

const tabNames: Record<WorkTab, string> = {
  tasks: 'Tasks',
  plan: 'Plan',
  crew: 'Crew',
  links: 'Links',
  changes: 'Changes',
  cost: 'Cost',
};

const TAB_STEPS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

function tabAfterKey(tabs: readonly WorkTab[], current: WorkTab, key: string): WorkTab | null {
  if (key === 'Home') return tabs[0]!;
  if (key === 'End') return tabs.at(-1)!;
  const step = TAB_STEPS[key];
  if (!step) return null;
  return tabs[(tabs.indexOf(current) + step + tabs.length) % tabs.length]!;
}

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

interface TaskDetailsProps {
  conversationId: string;
  task: TaskOverview;
  open: boolean;
  wide: boolean;
  tab: WorkTab;
  onTab(tab: WorkTab): void;
  onClose(): void;
  onAudit?: (() => void) | undefined;
  orchestration: Orchestration | null;
  agents: readonly CrewAgent[];
  roots: readonly string[];
  runs: readonly Run[];
  heading: Ref<HTMLHeadingElement>;
  autonomy: ReactNode;
}

export function TaskDetails({
  conversationId,
  task,
  open,
  wide,
  tab,
  onTab: setTab,
  onClose,
  onAudit,
  orchestration,
  agents,
  roots,
  runs,
  heading,
  autonomy,
}: TaskDetailsProps) {
  const items = task.items;
  const detail = useQuery({
    queryKey: taskKeys.task(task.id),
    queryFn: () => taskApi.get(task.id),
    enabled: open,
  });
  const tabs: WorkTab[] =
    task.planVersion || task.agreedPlanVersion
      ? ['tasks', 'plan', 'crew', 'links', 'changes', 'cost']
      : ['tasks', 'crew', 'links', 'changes', 'cost'];
  const current = tabs.includes(tab) ? tab : 'tasks';
  const pill = orchestration ? orchestrationPill(orchestration, task) : statusPill(task);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = tabAfterKey(tabs, current, event.key);
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(`wtab-${next}`)?.focus();
  };

  return (
    <>
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
      {autonomy}
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
        {current === 'crew' && agents.length > 0 && (
          <CrewPane
            runs={[]}
            agents={agents}
            conversationId={conversationId}
            labels={orchestration ? pieceLabels(orchestration) : undefined}
          />
        )}
        {current !== 'tasks' &&
          current !== 'changes' &&
          !(current === 'crew' && agents.length > 0) &&
          !detail.data && (
            <div className="wsec">
              <QueryWait query={detail} what={`the ${tabNames[current].toLowerCase()}`}>
                <Skeleton label={`Opening ${tabNames[current]}`} shape={PANE_SHAPES[current]} />
              </QueryWait>
            </div>
          )}
        {current === 'plan' && detail.data && (
          <PlanPane
            taskId={task.id}
            versions={detail.data.planVersions}
            runs={detail.data.runs}
            agreed={detail.data.agreedPlans}
          />
        )}
        {current === 'links' && detail.data && (
          <LinksPane taskId={task.id} conversationId={conversationId} links={detail.data.links} />
        )}
        {current === 'crew' && agents.length === 0 && detail.data && (
          <CrewPane runs={detail.data.runs} />
        )}
        {current === 'changes' && (
          <ChangesPane
            taskId={task.id}
            conversationId={conversationId}
            runs={detail.data?.runs ?? []}
          />
        )}
        {current === 'cost' && detail.data && (
          <CostPane task={detail.data} runs={runs} agents={agents} onAudit={onAudit} />
        )}
      </div>
    </>
  );
}
