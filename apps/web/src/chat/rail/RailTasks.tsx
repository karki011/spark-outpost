import { memo } from 'react';
import type { TaskItemState, TaskOverview } from '@spark-outpost/contracts';
import { CheckIcon, XIcon } from '../../ui/icons.tsx';

const STATE_WORDS: Record<TaskItemState, string> = {
  done: 'Done',
  active: 'In progress',
  waiting: 'Waiting for you',
  pending: 'Not started',
  failed: 'Failed',
};

function StateMark({ state }: { state: TaskItemState }) {
  if (state === 'done') return <CheckIcon />;
  if (state === 'failed') return <XIcon />;
  if (state === 'active') return <span className="spin" />;
  return <i className="crail-task-dot" />;
}

interface RailTasksProps {
  task: TaskOverview;
  onOpen(): void;
}

export const RailTasks = memo(function RailTasks({ task, onOpen }: RailTasksProps) {
  const { done, total } = task.summary;
  return (
    <section className="crail-tasks" aria-label="Tasks">
      <div className="crail-tasks-head">
        <h3 className="crail-title">Tasks</h3>
        <button
          type="button"
          className="crail-tasks-count"
          aria-label={`${done} of ${total} tasks done. Open the work panel`}
          title={task.title}
          onClick={onOpen}
        >
          {done} of {total}
        </button>
      </div>
      <ol tabIndex={0} aria-label="Task steps">
        {task.items.map((item) => {
          const current = item.state === 'active' || item.state === 'waiting';
          return (
            <li key={item.id} data-state={item.state} aria-current={current ? 'step' : undefined}>
              <span className="crail-task-mark" aria-hidden="true">
                <StateMark state={item.state} />
              </span>
              <span>
                <span className="crail-task-label" title={item.label}>
                  <span className="sr-only">{STATE_WORDS[item.state]}: </span>
                  {item.label}
                </span>
                {current && item.detail && <span className="crail-task-detail">{item.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
});
