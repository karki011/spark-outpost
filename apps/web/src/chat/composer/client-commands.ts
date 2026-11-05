import { planPrompt, reviewPrompt, type ClientCommandName } from './slash.ts';

interface ClientCommandDeps {
  openMcp: () => void;
  onStartFresh: (() => void) | undefined;
  notify: (message: string) => void;
  pick: (command: 'model' | 'effort', args: string) => void;
  setDraft: (text: string) => void;
}

export function runClientCommand(
  deps: ClientCommandDeps,
  command: ClientCommandName,
  args = '',
): string | null {
  if (command === 'mcp') {
    deps.openMcp();
    return null;
  }
  if (command === 'fresh') {
    deps.onStartFresh?.();
    deps.notify(
      deps.onStartFresh
        ? 'Started fresh. Your next message opens a new agent session.'
        : 'This chat has no agent session yet.',
    );
    return null;
  }
  if (command === 'model' || command === 'effort') {
    deps.pick(command, args);
    return null;
  }
  if (command === 'plan') {
    if (args) return planPrompt(args);
    deps.notify('Add what to plan after /plan.');
    deps.setDraft('/plan ');
    return null;
  }
  return reviewPrompt(args);
}
