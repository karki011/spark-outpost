import './task-card.css';
import type { TaskOverview } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import type { CrewAgent } from '../crew/crew-model.ts';
import { ChevronIcon } from '../ui/icons.tsx';

export function taskProviders(task: TaskOverview): string[] {
  return [...new Set(task.items.flatMap((item) => (item.agent ? [item.agent.provider] : [])))];
}

export function progressPercent(task: TaskOverview): number {
  return task.summary.total > 0 ? Math.round((task.summary.done / task.summary.total) * 100) : 0;
}

function statusWord(task: TaskOverview): string | null {
  const { text, done, total } = task.summary;
  const status = text.split(' · ').slice(1).join(' · ');
  if (status) return status;
  return total > 0 && done === total ? 'Done' : null;
}

function live(task: TaskOverview): boolean {
  return task.items.some((item) => item.state === 'waiting' || item.state === 'active');
}

interface TaskCardProps {
  task: TaskOverview;
  panelOpen: boolean;
  onOpen(): void;
  agents?: readonly CrewAgent[];
}

export function TaskCard({ task, panelOpen, onOpen, agents = [] }: TaskCardProps) {
  const waiting = task.summary.waiting > 0;
  const status = statusWord(task);
  const detail = live(task) ? null : task.title;
  return (
    <button
      type="button"
      className={waiting ? 'taskc wait' : 'taskc'}
      aria-label={`Task: ${task.title}. ${task.summary.text}. ${panelOpen ? 'Show' : 'Open'} the work panel`}
      title={task.title}
      onClick={onOpen}
    >
      <span className="stack" aria-hidden="true">
        {agents.length > 0
          ? agents.map((agent) => (
              <span key={agent.id}>
                <CrewBlob
                  name={agent.name}
                  provider={agent.provider}
                  state={agent.state}
                  size={16}
                />
              </span>
            ))
          : taskProviders(task).map((provider) => (
              <span key={provider}>
                <AgentBlob provider={provider} size={16} />
              </span>
            ))}
      </span>
      <b className="tc-count">
        Task {task.summary.done}/{task.summary.total}
      </b>
      {status && (
        <>
          <span className="tc-dot">·</span>
          <span className="tc-status">{status}</span>
        </>
      )}
      {detail && (
        <>
          <span className="tc-dot">·</span>
          <span className="tc-what">{detail}</span>
        </>
      )}
      <span className="hprog" aria-hidden="true">
        <i style={{ transform: `scaleX(${progressPercent(task) / 100})` }} />
      </span>
      <ChevronIcon />
    </button>
  );
}
