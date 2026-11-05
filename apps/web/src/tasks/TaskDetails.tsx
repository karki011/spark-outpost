import { useQuery } from '@tanstack/react-query';
import type { KeyboardEvent, ReactNode, Ref } from 'react';
import {
  isTerminalRunStatus,
  type Orchestration,
  type Run,
  type TaskDetail,
  type TaskOverview,
} from '@spark-outpost/contracts';
import type { CrewAgent } from '../crew/crew-model.ts';
import { pieceLabels } from '../crew/piece-labels.ts';
import { ChangesPane } from './ChangesPane.tsx';
import { CostPane } from './CostPane.tsx';
import { CrewPane } from './CrewPane.tsx';
import { LinksPane } from './LinksPane.tsx';
import { AgreedPlan } from './AgreedPlan.tsx';
import { TodoPane } from './TodoPane.tsx';
import { taskApi, taskKeys } from './task-api.ts';
import { TerminalCost } from '../terminal/usage/TerminalCost.tsx';
import { TerminalSteps } from '../terminal/usage/TerminalSteps.tsx';
import { WaitingItems } from './TaskList.tsx';
import { hasTodo, todoPercent } from '../todo/task-todo.ts';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton, type SkeletonShape } from '../ui/loading/Skeleton.tsx';
import { useChatPane } from '../chat/split/chat-pane.ts';

export type WorkTab = 'todo' | 'steps' | 'plan' | 'crew' | 'links' | 'changes' | 'cost';

const PANE_SHAPES: Record<WorkTab, SkeletonShape> = {
  todo: 'list',
  steps: 'list',
  plan: 'lines',
  crew: 'list',
  links: 'list',
  changes: 'list',
  cost: 'cards',
};

const NO_DETAIL: ReadonlySet<WorkTab> = new Set(['todo', 'steps', 'changes', 'crew']);

const tabNames: Record<WorkTab, string> = {
  todo: 'To-do',
  steps: 'Steps',
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
  if (task.summary.runState === 'working') return { className: 'spill prog', label: 'Working' };
  if (task.summary.runState === 'stopped') return { className: 'spill bad', label: 'Stopped' };
  if (task.summary.done < task.summary.total) {
    return { className: 'spill', label: 'Not finished' };
  }
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

function AgreedPlanPane({ plans }: { plans: TaskDetail['agreedPlans'] }) {
  if (plans && plans.documents.length > 0) return <AgreedPlan plans={plans} />;
  return <p className="wsec wnote">No agreed plan yet.</p>;
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
  terminal?: boolean;
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
  terminal = false,
}: TaskDetailsProps) {
  const { idSuffix } = useChatPane();
  const detail = useQuery({
    queryKey: taskKeys.task(task.id),
    queryFn: () => taskApi.get(task.id),
    enabled: open,
  });
  const listed = hasTodo(task);
  const showsTodo = listed || task.recorded.some((item) => item.state !== 'waiting');
  const hasPlan = Boolean(task.agreedPlanVersion);
  const storedCrew = orchestration !== null && agents.length > 0;
  const tabs: WorkTab[] = [
    ...(showsTodo ? (['todo'] as const) : []),
    ...(terminal ? (['steps'] as const) : []),
    ...(hasPlan ? (['plan'] as const) : []),
    ...(storedCrew ? (['crew'] as const) : []),
    'links',
    'changes',
    'cost',
  ];
  const current = tabs.includes(tab) ? tab : tabs[0]!;
  const pill = orchestration ? orchestrationPill(orchestration, task) : statusPill(task);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = tabAfterKey(tabs, current, event.key);
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(`wtab-${next}${idSuffix}`)?.focus();
  };

  return (
    <>
      <WaitingItems items={task.recorded} roots={roots} {...(wide ? {} : { onReview: onClose })} />
      <section className="wtask">
        <div className="wt-h">
          <h2 ref={heading} tabIndex={-1}>
            {listed ? 'To-do' : 'This chat'}
          </h2>
          {(listed || orchestration) && <span className={pill.className}>{pill.label}</span>}
        </div>
        {task.summary.text && <p className="wprog">{task.summary.text}</p>}
        {listed && (
          <div
            className="wbar"
            role="progressbar"
            aria-label="To-do progress"
            aria-valuemin={0}
            aria-valuemax={task.summary.total}
            aria-valuenow={task.summary.done}
          >
            <i style={{ transform: `scaleX(${todoPercent(task) / 100})` }} />
          </div>
        )}
      </section>
      {autonomy}
      <div className="wtabs" role="tablist" aria-label="Task details">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`wtab-${id}${idSuffix}`}
            aria-selected={current === id}
            aria-controls={`wpane${idSuffix}`}
            tabIndex={current === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={onTabKey}
          >
            {id === 'todo' && !listed ? 'Recorded' : tabNames[id]}
          </button>
        ))}
      </div>
      <div
        className="wpane"
        id={`wpane${idSuffix}`}
        role="tabpanel"
        aria-labelledby={`wtab-${current}${idSuffix}`}
      >
        {current === 'todo' && (
          <TodoPane
            taskId={task.id}
            todo={task.todo}
            recorded={task.recorded}
            detail={detail.data}
            roots={roots}
          />
        )}
        {current === 'crew' && orchestration && (
          <CrewPane agents={agents} labels={pieceLabels(orchestration)} />
        )}
        {current === 'steps' && <TerminalSteps conversationId={conversationId} />}
        {current === 'cost' && terminal && <TerminalCost conversationId={conversationId} />}
        {open && !NO_DETAIL.has(current) && !detail.data && (
          <div className="wsec">
            <QueryWait query={detail} what={`the ${tabNames[current].toLowerCase()}`}>
              <Skeleton label={`Opening ${tabNames[current]}`} shape={PANE_SHAPES[current]} />
            </QueryWait>
          </div>
        )}
        {current === 'plan' && detail.data && <AgreedPlanPane plans={detail.data.agreedPlans} />}
        {current === 'links' && detail.data && (
          <LinksPane taskId={task.id} conversationId={conversationId} links={detail.data.links} />
        )}
        {current === 'changes' && (
          <ChangesPane
            taskId={task.id}
            conversationId={conversationId}
            runs={detail.data?.runs ?? []}
          />
        )}
        {current === 'cost' && detail.data && (
          <CostPane
            task={detail.data}
            runs={runs}
            agents={agents}
            onAudit={onAudit}
            conversationId={conversationId}
          />
        )}
      </div>
    </>
  );
}
