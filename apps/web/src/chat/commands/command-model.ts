import {
  COMMAND_BROWSER_CHARS,
  COMMAND_DESCRIBED,
  COMMAND_FINISHED,
  COMMAND_OUTPUT,
  COMMAND_STARTED,
  commandDescribedSchema,
  commandFinishedSchema,
  commandOutputSchema,
  commandStartedSchema,
  outputTail,
  type CommandOutput,
  type CommandRun,
} from '@spark-outpost/contracts';

export interface LiveCommand extends Omit<CommandRun, 'runId'> {
  output: string | null;
  received: number;
  appended: number;
  epoch: number;
}

export interface CommandView extends LiveCommand {
  runId: string;
}

interface NamedEvent {
  name: string;
  value?: unknown;
}

export function skippedNote(chars: number): string {
  return `\n[… ${chars.toLocaleString('en-US')} characters not shown …]\n`;
}

function withOutput(command: LiveCommand, { at, chunk, reset }: CommandOutput): LiveCommand {
  const end = at + chunk.length;
  if (reset) {
    return {
      ...command,
      output: outputTail(chunk, COMMAND_BROWSER_CHARS),
      received: end,
      appended: chunk.length,
      epoch: command.epoch + 1,
    };
  }
  if (end <= command.received) return command;
  const gap = at > command.received ? skippedNote(at - command.received) : '';
  const added = gap + chunk.slice(Math.max(0, command.received - at));
  return {
    ...command,
    output: outputTail((command.output ?? '') + added, COMMAND_BROWSER_CHARS),
    received: end,
    appended: command.appended + added.length,
  };
}

function update(
  commands: readonly LiveCommand[],
  id: string,
  change: (command: LiveCommand) => LiveCommand,
): readonly LiveCommand[] {
  const index = commands.findIndex((command) => command.id === id);
  if (index === -1) return commands;
  const changed = change(commands[index]!);
  return changed === commands[index] ? commands : commands.with(index, changed);
}

export function applyCommandEvent(
  commands: readonly LiveCommand[],
  event: NamedEvent,
): readonly LiveCommand[] {
  if (event.name === COMMAND_STARTED) {
    const started = commandStartedSchema.safeParse(event.value);
    if (!started.success || commands.some((command) => command.id === started.data.id)) {
      return commands;
    }
    return [
      ...commands,
      {
        ...started.data,
        status: 'running',
        exitCode: null,
        finishedAt: null,
        outputChars: 0,
        output: '',
        received: 0,
        appended: 0,
        epoch: 0,
      },
    ];
  }
  if (event.name === COMMAND_DESCRIBED) {
    const described = commandDescribedSchema.safeParse(event.value);
    if (!described.success) return commands;
    const { id, description } = described.data;
    return update(commands, id, (command) => ({ ...command, description }));
  }
  if (event.name === COMMAND_OUTPUT) {
    const output = commandOutputSchema.safeParse(event.value);
    if (!output.success) return commands;
    return update(commands, output.data.id, (command) =>
      command.status === 'running' ? withOutput(command, output.data) : command,
    );
  }
  if (event.name === COMMAND_FINISHED) {
    const finished = commandFinishedSchema.safeParse(event.value);
    if (!finished.success) return commands;
    const { id, ...end } = finished.data;
    return update(commands, id, (command) =>
      command.status === 'running' ? { ...command, ...end } : command,
    );
  }
  return commands;
}

function stored(command: CommandRun): CommandView {
  return { ...command, output: null, received: 0, appended: 0, epoch: 0 };
}

export function shownCommands(
  saved: readonly CommandRun[],
  streamed: readonly LiveCommand[],
  streamRunId: string,
): CommandView[] {
  const live = new Map(streamed.map((command) => [command.id, command]));
  const merged = saved.map((command): CommandView => {
    const seen = live.get(command.id);
    live.delete(command.id);
    if (!seen) return stored(command);
    if (command.status === 'running') return { ...seen, runId: command.runId };
    const { output, received, appended, epoch } = seen;
    return { ...command, output, received, appended, epoch };
  });
  return [...merged, ...[...live.values()].map((command) => ({ ...command, runId: streamRunId }))];
}

export function runCommands(
  commands: readonly CommandRun[] | undefined,
  runIds: readonly (string | null | undefined)[],
): CommandRun[] {
  return (commands ?? []).filter((command) => runIds.includes(command.runId));
}

export function commandSeconds(command: LiveCommand, now: number): number {
  const end = command.finishedAt ? Date.parse(command.finishedAt) : now;
  return Math.max(0, Math.round((end - Date.parse(command.startedAt)) / 1000));
}

export function shownDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function commandOutcome(command: LiveCommand): string {
  if (command.status === 'running') return 'Running';
  if (command.status === 'interrupted') return 'Interrupted';
  const code = command.exitCode === null ? '' : `, exit code ${command.exitCode}`;
  return command.status === 'failed' ? `Failed${code}` : `Finished${code}`;
}
