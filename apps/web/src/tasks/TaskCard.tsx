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

function currentLine(task: TaskOverview): string {
  const focus =
    task.items.find((item) => item.state === 'waiting') ??
    task.items.find((item) => item.state === 'active');
  return focus ? focus.label : task.title;
}

interface TaskCardProps {
  task: TaskOverview;
  panelOpen: boolean;
  onOpen(): void;
  agents?: readonly CrewAgent[];
}

export function TaskCard({ task, panelOpen, onOpen, agents = [] }: TaskCardProps) {
  const waiting = task.summary.waiting > 0;
  return (
    <button
      type="button"
      className={waiting ? 'taskc wait' : 'taskc'}
      aria-label={`Task: ${task.title}. ${task.summary.text}. ${panelOpen ? 'Show' : 'Open'} the work panel`}
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
                  size={20}
                />
              </span>
            ))
          : taskProviders(task).map((provider) => (
              <span key={provider}>
                <AgentBlob provider={provider} size={20} />
              </span>
            ))}
      </span>
      <span className="tx">
        <b>Task · {task.summary.text}</b>
        <small>{currentLine(task)}</small>
        <span className="hprog" aria-hidden="true">
          <i style={{ transform: `scaleX(${progressPercent(task) / 100})` }} />
        </span>
      </span>
      <ChevronIcon />
    </button>
  );
}
