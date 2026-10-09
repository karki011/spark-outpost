import type { CommandRun } from '@spark-outpost/contracts';
import {
  commandOutcome,
  shownCommands,
  type CommandView,
  type LiveCommand,
} from '../../chat/commands/command-model.ts';

export interface MirroredCommand {
  runId: string;
  commandId: string;
}

export type MirrorStatus = 'starting' | 'open' | 'ended';

export type MirrorBody = 'finding' | 'missing' | 'awaits-end' | 'loading' | 'empty' | 'screen';

const LABEL_COMMAND_CHARS = 32;
const UNKNOWN_AGENT = 'Agent';

export const AGENT_TAB_WORDS = 'run by the agent';
export const MIRROR_OWNER_NOTE = 'This command belongs to the agent’s turn.';
export const MIRROR_AWAITS_END = 'Output shows when the command ends.';
export const MIRROR_MISSING = 'Spark has no record of this command.';

export function findCommandTab<Tab extends { mirror: MirroredCommand | null }>(
  tabs: readonly Tab[],
  { runId, commandId }: MirroredCommand,
): Tab | null {
  return (
    tabs.find((tab) => tab.mirror?.runId === runId && tab.mirror.commandId === commandId) ?? null
  );
}

export function mirroredCommand(
  saved: readonly CommandRun[] | undefined,
  streamed: readonly LiveCommand[],
  { runId, commandId }: MirroredCommand,
): CommandView | null {
  const stored = (saved ?? []).filter(
    (command) => command.runId === runId && command.id === commandId,
  );
  const live = streamed.filter((command) => command.id === commandId);
  return shownCommands(stored, live, runId)[0] ?? null;
}

export function isSettled(saved: readonly CommandRun[] | undefined, mirror: MirroredCommand) {
  const stored = mirroredCommand(saved, [], mirror);
  return stored !== null && stored.status !== 'running';
}

export function commandTabLabel(agent: string | null, command: string): string {
  const line = command.replace(/\s+/g, ' ').trim();
  const short =
    line.length > LABEL_COMMAND_CHARS ? `${line.slice(0, LABEL_COMMAND_CHARS - 1)}…` : line;
  return `${agent ?? UNKNOWN_AGENT} · ${short}`;
}

export function mirrorStatus(command: CommandView | null, searching: boolean): MirrorStatus {
  if (command) return command.status === 'running' ? 'open' : 'ended';
  return searching ? 'starting' : 'ended';
}

export function needsSavedOutput(command: CommandView | null): boolean {
  return command !== null && command.output === null;
}

export function mirrorBody(
  command: CommandView | null,
  text: string | null,
  searching: boolean,
): MirrorBody {
  if (!command) return searching ? 'finding' : 'missing';
  const running = command.status === 'running';
  if (running && !command.live && !text) return 'awaits-end';
  if (text === null) return 'loading';
  if (text === '' && !running) return 'empty';
  return 'screen';
}

export function mirrorEnding(command: CommandView, text: string | null): string {
  if (command.status !== 'interrupted') return `${commandOutcome(command)}.`;
  return text
    ? 'Interrupted before it finished. This is what was captured.'
    : 'Interrupted before it finished. No output was captured.';
}
