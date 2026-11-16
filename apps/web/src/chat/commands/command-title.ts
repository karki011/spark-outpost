import { friendlyStep, isMcpToolName } from '@spark-outpost/contracts';
import type { CommandView } from './command-model.ts';
import { commandName } from './command-name.ts';

export function commandTitle(command: Pick<CommandView, 'description' | 'command'>): string {
  return (
    command.description ||
    (isMcpToolName(command.command) ? friendlyStep(command.command) : commandName(command.command))
  );
}

export function commandVerb(
  command: Pick<CommandView, 'description' | 'command'>,
  running: boolean,
): string | null {
  if (command.description || isMcpToolName(command.command)) return null;
  return running ? 'Running' : 'Ran';
}

export function commandLine(
  command: Pick<CommandView, 'description' | 'command'>,
  running: boolean,
): string {
  const verb = commandVerb(command, running);
  const title = commandTitle(command);
  return verb ? `${verb} ${title}` : title;
}
