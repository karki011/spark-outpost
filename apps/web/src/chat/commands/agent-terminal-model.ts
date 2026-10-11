import {
  AGENT_TERMINAL_STARTED,
  agentTerminalLive,
  agentTerminalStartedSchema,
  agentTerminalStateText,
  type AgentTerminal,
  type AgentTerminalStarted,
} from '@spark-outpost/contracts';
import { shownDuration } from './command-model.ts';

export type AgentTerminalView = Pick<
  AgentTerminal,
  | 'id'
  | 'runId'
  | 'name'
  | 'command'
  | 'cwd'
  | 'state'
  | 'exitCode'
  | 'stoppedBy'
  | 'startedAt'
  | 'endedAt'
  | 'textOffset'
  | 'textBefore'
  | 'textHeld'
>;

interface NamedEvent {
  name: string;
  value?: unknown;
}

export function applyAgentTerminalEvent(
  started: readonly AgentTerminalStarted[],
  event: NamedEvent,
): readonly AgentTerminalStarted[] {
  if (event.name !== AGENT_TERMINAL_STARTED) return started;
  const parsed = agentTerminalStartedSchema.safeParse(event.value);
  if (!parsed.success || started.some((terminal) => terminal.id === parsed.data.id)) {
    return started;
  }
  return [...started, parsed.data];
}

function justStarted(started: AgentTerminalStarted, runId: string): AgentTerminalView {
  return { ...started, runId, state: 'starting', exitCode: null, stoppedBy: null, endedAt: null };
}

export function turnAgentTerminals(
  saved: readonly AgentTerminal[] | undefined,
  streamed: readonly AgentTerminalStarted[],
  runIds: readonly (string | null | undefined)[],
  streamRunId: string,
): AgentTerminalView[] {
  const stored = (saved ?? []).filter((terminal) => runIds.includes(terminal.runId));
  const known = new Set((saved ?? []).map((terminal) => terminal.id));
  const fresh = streamed.filter((terminal) => !known.has(terminal.id));
  return [...stored, ...fresh.map((terminal) => justStarted(terminal, streamRunId))];
}

export function agentTerminalSeconds(terminal: AgentTerminalView, now: number): number {
  const end = terminal.endedAt ? Date.parse(terminal.endedAt) : now;
  return Math.max(0, Math.round((end - Date.parse(terminal.startedAt)) / 1000));
}

export function agentTerminalRowState(terminal: AgentTerminalView, now: number): string {
  const text = agentTerminalStateText(terminal);
  if (terminal.state === 'starting' || terminal.state === 'failed') return text;
  return `${text} · ${shownDuration(agentTerminalSeconds(terminal, now))}`;
}

export function agentTerminalSpoken(terminal: AgentTerminalView): string {
  const what = terminal.command.slice(0, 120);
  if (agentTerminalLive(terminal.state)) return `Agent terminal running ${what}`;
  return `Agent terminal ${agentTerminalStateText(terminal)}: ${what}`;
}

export type AgentTerminalMark = 'live' | 'ok' | 'ended';

export function agentTerminalMark(terminal: AgentTerminalView): AgentTerminalMark {
  if (agentTerminalLive(terminal.state)) return 'live';
  return terminal.state === 'exited' && terminal.exitCode === 0 ? 'ok' : 'ended';
}
