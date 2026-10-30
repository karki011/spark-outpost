import { friendlyStep, type SubagentRow } from '@spark-outpost/contracts';
import type { CommandView } from '../commands/command-model.ts';
import { commandTitle } from '../commands/command-title.ts';
import type { RunStep } from '../run-projection.ts';

export interface LeadStep {
  label: string;
  since: number | null;
}

export interface LeadInput {
  subagents: readonly Pick<SubagentRow, 'state'>[];
  commands: readonly Pick<CommandView, 'status' | 'description' | 'command' | 'startedAt'>[];
  steps: readonly Pick<RunStep, 'name' | 'done' | 'subagent' | 'waits' | 'startedAt'>[];
  publishing: { since: number | null } | null;
}

function timeOf(iso: string): number | null {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

export function leadStep({ subagents, commands, steps, publishing }: LeadInput): LeadStep {
  const agents = subagents.filter((row) => row.state === 'working').length;
  if (agents > 0) {
    return { label: agents === 1 ? 'Running agent' : `Running ${agents} agents`, since: null };
  }
  const running = commands.findLast((command) => command.status === 'running');
  if (running) {
    return { label: `Running ${commandTitle(running)}`, since: timeOf(running.startedAt) };
  }
  const open = steps.findLast((step) => !step.done && !step.subagent && !step.waits);
  if (open) {
    const label = friendlyStep(open.name).replaceAll('`', '').trim();
    return { label: label || 'Working', since: open.startedAt ?? null };
  }
  if (publishing) return { label: 'Publishing', since: publishing.since };
  return { label: 'Thinking', since: null };
}
