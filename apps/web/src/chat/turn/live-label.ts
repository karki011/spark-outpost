import { friendlyStep, type SubagentRow } from '@spark-outpost/contracts';
import type { CommandView } from '../commands/command-model.ts';
import { commandLine } from '../commands/command-title.ts';
import type { RunStep } from '../run-projection.ts';
import { stepKind } from '../status/step-activity.ts';

export interface LeadStep {
  label: string;
  since: number | null;
  thought?: string;
  quietSince?: number;
  repeatsRow?: true;
}

export interface LeadInput {
  subagents: readonly Pick<SubagentRow, 'state'>[];
  commands: readonly Pick<CommandView, 'status' | 'description' | 'command' | 'startedAt'>[];
  steps: readonly Pick<RunStep, 'name' | 'done' | 'subagent' | 'waits' | 'startedAt' | 'thought'>[];
  publishing: { since: number | null } | null;
  outputAt?: number | null;
}

function liveThought(step: Pick<RunStep, 'name' | 'thought'>): { thought?: string } {
  const thought = step.thought?.trim();
  return thought && stepKind(step.name) === 'think' ? { thought } : {};
}

function quietFrom(outputAt: number | null | undefined): { quietSince?: number } {
  return outputAt === null || outputAt === undefined ? {} : { quietSince: outputAt };
}

function timeOf(iso: string): number | null {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

export function leadStep({
  subagents,
  commands,
  steps,
  publishing,
  outputAt,
}: LeadInput): LeadStep {
  const agents = subagents.filter((row) => row.state === 'working').length;
  if (agents > 0) {
    return {
      label: agents === 1 ? 'Running agent' : `Running ${agents} agents`,
      since: null,
      repeatsRow: true,
    };
  }
  const running = commands.findLast((command) => command.status === 'running');
  if (running) {
    return {
      label: commandLine(running, true),
      since: timeOf(running.startedAt),
      repeatsRow: true,
    };
  }
  const open = steps.findLast((step) => !step.done && !step.subagent && !step.waits);
  if (open) {
    const label = friendlyStep(open.name).replaceAll('`', '').trim();
    const thinking = stepKind(open.name) === 'think';
    return {
      label: label || 'Working',
      since: open.startedAt ?? null,
      ...liveThought(open),
      ...(thinking ? quietFrom(outputAt) : {}),
    };
  }
  if (publishing) return { label: 'Publishing', since: publishing.since };
  return { label: 'Thinking', since: null, ...quietFrom(outputAt) };
}
