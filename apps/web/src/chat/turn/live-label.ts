import type { SubagentRow } from '@spark-outpost/contracts';
import type { CommandView } from '../commands/command-model.ts';
import { commandTitle } from '../commands/command-title.ts';

export function liveLabel(
  subagents: readonly Pick<SubagentRow, 'state'>[],
  commands: readonly Pick<CommandView, 'status' | 'description' | 'command'>[],
): string {
  const agents = subagents.filter((row) => row.state === 'working').length;
  if (agents > 0) return agents === 1 ? 'Running agent' : `Running ${agents} agents`;
  const running = commands.findLast((command) => command.status === 'running');
  return running ? `Running ${commandTitle(running)}` : 'Working';
}
