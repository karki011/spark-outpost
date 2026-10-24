import type { CommandView } from './command-model.ts';
import { commandName } from './command-name.ts';

export function commandTitle(command: Pick<CommandView, 'description' | 'command'>): string {
  return command.description || commandName(command.command);
}
