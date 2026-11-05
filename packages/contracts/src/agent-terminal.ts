import { z } from 'zod';
import { COMMAND_STORED_CHARS, COMMAND_TEXT_MAX } from './command-runs.ts';

export const AGENT_TERMINAL_TOOL = 'spark_terminal_run';
export const AGENT_TERMINAL_STARTED = 'agent_terminal_started';
export const AGENT_TERMINAL_CHANGE = 'agent_terminal';

export const AGENT_TERMINAL_NAME_MAX = 60;
export const AGENT_TERMINAL_OUTPUT_LINES = 200;
export const AGENT_TERMINAL_STORED_CHARS = COMMAND_STORED_CHARS;

export const agentTerminalStateSchema = z.enum([
  'starting',
  'running',
  'exited',
  'stopped',
  'failed',
  'interrupted',
]);
export type AgentTerminalState = z.infer<typeof agentTerminalStateSchema>;

export const agentTerminalWantedSchema = z.enum(['running', 'stopped']);
export type AgentTerminalWanted = z.infer<typeof agentTerminalWantedSchema>;

export const agentTerminalStopperSchema = z.enum([
  'user',
  'agent',
  'turn_stopped',
  'quit',
  'chat_removed',
  'folder_removed',
]);
export type AgentTerminalStopper = z.infer<typeof agentTerminalStopperSchema>;

export const agentTerminalDeciderSchema = z.enum(['mode', 'card']);
export type AgentTerminalDecider = z.infer<typeof agentTerminalDeciderSchema>;

const anchorFields = {
  textOffset: z.number().int().nonnegative().nullable(),
  textBefore: z.string().nullable(),
  textHeld: z.number().int().nonnegative().nullable(),
};

export const agentTerminalSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  runId: z.uuid().nullable(),
  provider: z.string(),
  name: z.string().max(AGENT_TERMINAL_NAME_MAX),
  command: z.string().max(COMMAND_TEXT_MAX),
  cwd: z.string(),
  state: agentTerminalStateSchema,
  exitCode: z.number().int().nullable(),
  decidedBy: agentTerminalDeciderSchema,
  stoppedBy: agentTerminalStopperSchema.nullable(),
  outputChars: z.number().int().nonnegative(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  ...anchorFields,
});
export type AgentTerminal = z.infer<typeof agentTerminalSchema>;

export const agentTerminalListSchema = z.object({ terminals: z.array(agentTerminalSchema) });
export type AgentTerminalList = z.infer<typeof agentTerminalListSchema>;

export const agentTerminalStartedSchema = z.object({
  id: z.uuid(),
  name: z.string().max(AGENT_TERMINAL_NAME_MAX),
  command: z.string().max(COMMAND_TEXT_MAX),
  cwd: z.string(),
  startedAt: z.string(),
  ...anchorFields,
});
export type AgentTerminalStarted = z.infer<typeof agentTerminalStartedSchema>;

export const agentTerminalChangeSchema = z.object({
  kind: z.literal(AGENT_TERMINAL_CHANGE),
  conversationId: z.uuid().nullable(),
  runId: z.uuid().nullable(),
});
export type AgentTerminalChange = z.infer<typeof agentTerminalChangeSchema>;

const commandText = z.string().trim().min(1).max(COMMAND_TEXT_MAX);

export const agentTerminalStartInputSchema = z.object({
  action: z.literal('start'),
  command: commandText,
  name: z.string().trim().min(1).max(AGENT_TERMINAL_NAME_MAX).optional(),
  cwd: z.string().trim().min(1).optional(),
});
export const agentTerminalStatusInputSchema = z.object({ action: z.literal('status') });
export const agentTerminalOutputInputSchema = z.object({
  action: z.literal('output'),
  id: z.uuid(),
  lines: z.number().int().min(1).max(AGENT_TERMINAL_OUTPUT_LINES).optional(),
});
export const agentTerminalStopInputSchema = z.object({ action: z.literal('stop'), id: z.uuid() });

export const agentTerminalInputSchema = z.discriminatedUnion('action', [
  agentTerminalStartInputSchema,
  agentTerminalStatusInputSchema,
  agentTerminalOutputInputSchema,
  agentTerminalStopInputSchema,
]);
export type AgentTerminalInput = z.infer<typeof agentTerminalInputSchema>;
export type AgentTerminalAction = AgentTerminalInput['action'];

export const agentTerminalBriefSchema = agentTerminalSchema.pick({
  id: true,
  name: true,
  command: true,
  cwd: true,
  state: true,
  exitCode: true,
  stoppedBy: true,
  startedAt: true,
  endedAt: true,
});
export type AgentTerminalBrief = z.infer<typeof agentTerminalBriefSchema>;

export const agentTerminalStartResultSchema = z.object({
  action: z.literal('start'),
  terminal: agentTerminalBriefSchema,
});
export const agentTerminalStatusResultSchema = z.object({
  action: z.literal('status'),
  terminals: z.array(agentTerminalBriefSchema),
});
export const agentTerminalOutputResultSchema = z.object({
  action: z.literal('output'),
  terminal: agentTerminalBriefSchema,
  output: z.string(),
  lines: z.number().int().nonnegative(),
  outputChars: z.number().int().nonnegative(),
  untrusted: z.literal(true),
});
export const agentTerminalStopResultSchema = z.object({
  action: z.literal('stop'),
  terminal: agentTerminalBriefSchema,
});

export const agentTerminalResultSchema = z.discriminatedUnion('action', [
  agentTerminalStartResultSchema,
  agentTerminalStatusResultSchema,
  agentTerminalOutputResultSchema,
  agentTerminalStopResultSchema,
]);
export type AgentTerminalResult = z.infer<typeof agentTerminalResultSchema>;

const LIVE_STATES: readonly AgentTerminalState[] = ['starting', 'running'];

export function agentTerminalLive(state: AgentTerminalState): boolean {
  return LIVE_STATES.includes(state);
}

export function agentTerminalMoves(from: AgentTerminalState, to: AgentTerminalState): boolean {
  if (!agentTerminalLive(from) || from === to) return false;
  return to !== 'starting';
}

export interface AgentTerminalExit {
  wanted: AgentTerminalWanted;
  exitCode: number | null;
  spawned: boolean;
}

export function agentTerminalEndState(exit: AgentTerminalExit): AgentTerminalState {
  if (exit.wanted === 'stopped') return 'stopped';
  return exit.spawned ? 'exited' : 'failed';
}

export function agentTerminalBrief(terminal: AgentTerminal): AgentTerminalBrief {
  return agentTerminalBriefSchema.parse(terminal);
}

export function agentTerminalName(command: string): string {
  const line = command.replace(/\s+/g, ' ').trim();
  if (line.length <= AGENT_TERMINAL_NAME_MAX) return line;
  return `${line.slice(0, AGENT_TERMINAL_NAME_MAX - 1)}…`;
}

const STOPPED_TEXT: Record<AgentTerminalStopper, string> = {
  user: 'stopped by you',
  agent: 'stopped by the agent',
  turn_stopped: 'stopped with the turn',
  quit: 'stopped when Spark quit',
  chat_removed: 'stopped when the chat was removed',
  folder_removed: 'stopped when its folder was removed',
};

type Ending = Pick<AgentTerminal, 'state' | 'exitCode' | 'stoppedBy'>;

export function agentTerminalStateText(terminal: Ending): string {
  switch (terminal.state) {
    case 'starting':
      return 'starting';
    case 'running':
      return 'running';
    case 'exited':
      return terminal.exitCode === null ? 'ended' : `exit ${terminal.exitCode}`;
    case 'failed':
      return 'could not start';
    case 'interrupted':
      return STOPPED_TEXT.quit;
    case 'stopped':
      return terminal.stoppedBy ? STOPPED_TEXT[terminal.stoppedBy] : 'stopped';
  }
}

export function agentTerminalsRunningLine(terminals: readonly Pick<AgentTerminal, 'state'>[]) {
  const running = terminals.filter((terminal) => agentTerminalLive(terminal.state)).length;
  if (running === 0) return null;
  return `${running} agent ${running === 1 ? 'terminal' : 'terminals'} still running`;
}

export function agentTerminalOutputTail(output: string, lines: number): string {
  const all = output.split('\n');
  const trailing = all.at(-1) === '' ? 1 : 0;
  const kept = all.slice(Math.max(0, all.length - trailing - lines));
  return kept.join('\n');
}
