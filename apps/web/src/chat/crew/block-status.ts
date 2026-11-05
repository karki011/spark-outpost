import type { CrewAgent, CrewState } from '../../crew/crew-model.ts';
import type { RunStep } from '../run-projection.ts';
import { timedOut, WAITED_LABEL } from '../approvals/timed-out.ts';
import { stepActivity } from '../status/step-activity.ts';

export interface BlockStatus {
  state: CrewState;
  label: string;
}

interface BlockWork {
  steps: readonly RunStep[];
  waiting: boolean;
  started: boolean;
}

const SETTLED: Partial<Record<CrewState, string>> = {
  done: 'done',
  failed: 'hit a problem',
  stopped: 'stopped',
};

function stepWords(name: string): string {
  const activity = stepActivity(name);
  if (activity.kind === 'think') return 'thinking';
  const words = activity.target ? `${activity.verb} ${activity.target}` : activity.verb;
  return words.charAt(0).toLowerCase() + words.slice(1);
}

export function blockStatus(
  agent: Pick<CrewAgent, 'state'>,
  { steps, waiting, started }: BlockWork,
  error: string | null = null,
): BlockStatus {
  if (timedOut(error)) return { state: 'stopped', label: WAITED_LABEL };
  const settled = SETTLED[agent.state];
  if (settled) return { state: agent.state, label: settled };
  if (waiting || agent.state === 'waiting') return { state: 'waiting', label: 'waiting for you' };
  if (agent.state === 'queued') return { state: 'queued', label: 'queued' };
  const open = steps.findLast((step) => !step.done);
  if (open) return { state: 'working', label: stepWords(open.name) };
  const untouched = agent.state === 'thinking' && !started && steps.length === 0;
  if (untouched) return { state: 'thinking', label: 'thinking' };
  return { state: 'working', label: 'working' };
}
