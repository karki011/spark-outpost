import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as acp from '@agentclientprotocol/sdk';

const run = promisify(execFile);

export interface CommandTurn {
  sessionId: string;
  cwd: string;
  client: acp.AgentContext;
  update(value: acp.SessionUpdate): Promise<void>;
}

export interface CommandSession {
  rules: readonly string[];
  mode: string;
}

const BASH_RULE = /^Bash\((.+):\*\)$/;
const COMMAND_SEPARATORS = /&&|\|\||[;|\n]/;
const MANUAL_MODE = 'default';
const READS_MANUAL_RUNS_UNASKED = [
  'git status',
  'git log',
  'git diff',
  'git config --get',
  'git config --list',
];

const startsWithWords = (command: string, prefix: string) =>
  command === prefix || command.startsWith(`${prefix} `);

export function asksBeforeRunning(rules: readonly string[], command: string): boolean {
  const prefixes = rules.flatMap((rule) => BASH_RULE.exec(rule)?.[1] ?? []);
  return command
    .split(COMMAND_SEPARATORS)
    .map((part) => part.trim())
    .some((part) => prefixes.some((prefix) => startsWithWords(part, prefix)));
}

function modeAsks(mode: string, command: string): boolean {
  if (mode !== MANUAL_MODE) return false;
  return !READS_MANUAL_RUNS_UNASKED.some((read) => startsWithWords(command, read));
}

const OPTIONS: acp.PermissionOption[] = [
  { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
  { optionId: 'no', name: 'No', kind: 'reject_once' },
];

async function permitted(turn: CommandTurn, toolCall: acp.ToolCallUpdate): Promise<boolean> {
  const answer = await turn.client.request(acp.methods.client.session.requestPermission, {
    sessionId: turn.sessionId,
    toolCall,
    options: OPTIONS,
  });
  return answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'yes';
}

export async function runCommand(
  turn: CommandTurn,
  session: CommandSession,
  toolCallId: string,
  command: string,
  executes = false,
): Promise<void> {
  const call = { toolCallId, title: command, kind: 'execute' as const, rawInput: { command } };
  const asks = asksBeforeRunning(session.rules, command) || modeAsks(session.mode, command);
  const status = asks ? ('pending' as const) : ('in_progress' as const);
  await turn.update({ sessionUpdate: 'tool_call', ...call, status });
  if (asks && !(await permitted(turn, { ...call, status }))) {
    await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' });
    return;
  }
  if (executes) await run('sh', ['-c', command], { cwd: turn.cwd }).catch(() => null);
  await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
}
