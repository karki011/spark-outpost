import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk/unstable';
import { readFakeSession } from './fake-acp-sessions.ts';
import { stepsTurn } from './fake-acp-steps.ts';

export const THREAD_REPLY_COMMAND =
  'gh api repos/acme/widgets/pulls/1/comments/55/replies -f body=Fixed';

export interface FakeTurn {
  text: string;
  sessionId: string;
  cwd: string;
  client: acp.AgentContext;
  update(value: acp.SessionUpdate): Promise<void>;
  say(chunk: string): Promise<void>;
  signal: AbortSignal;
}

function priorPrompts(sessionId: string): number {
  try {
    return readFakeSession(sessionId).prompts.length - 1;
  } catch {
    return 0;
  }
}

async function current(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function runCommand(turn: FakeTurn, toolCallId: string, command: string): Promise<void> {
  const toolCall = {
    toolCallId,
    title: command,
    kind: 'execute' as const,
    status: 'pending' as const,
    rawInput: { command },
  };
  await turn.update({ sessionUpdate: 'tool_call', ...toolCall });
  const answer = (await turn.client.request(acp.methods.client.session.requestPermission, {
    sessionId: turn.sessionId,
    toolCall,
    options: [
      { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
      { optionId: 'no', name: 'No', kind: 'reject_once' },
    ],
  })) as acp.RequestPermissionResponse;
  const allowed = answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'yes';
  await turn.update({
    sessionUpdate: 'tool_call_update',
    toolCallId: toolCall.toolCallId,
    status: allowed ? 'completed' : 'failed',
  });
}

async function write(turn: FakeTurn, file: string, line: string): Promise<boolean> {
  const target = join(turn.cwd, file);
  const before = await current(target);
  const toolCallId = `write-${line.replace(/\W+/g, '-')}`;
  await turn.update({
    sessionUpdate: 'tool_call',
    toolCallId,
    title: `Write ${file}`,
    kind: 'edit',
    status: 'pending',
  });
  try {
    await turn.client.request(acp.methods.client.fs.writeTextFile, {
      sessionId: turn.sessionId,
      path: target,
      content: `${before}${line}\n`,
    });
    await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
    return true;
  } catch {
    await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' });
    await turn.say(`Could not write ${file}.`);
    return false;
  }
}

export async function buildTurn(turn: FakeTurn): Promise<acp.StopReason | null> {
  const stepped = await stepsTurn(turn);
  if (stepped) return stepped;
  if (!turn.text.includes('#build')) return null;
  if (!(await write(turn, 'notes.txt', 'step 1'))) return 'end_turn';
  if (turn.text.includes('#push')) await runCommand(turn, 'push-1', 'git push origin main');
  if (turn.text.includes('#reply')) await runCommand(turn, 'reply-1', THREAD_REPLY_COMMAND);
  if (turn.text.includes('#slowbuild')) {
    for (;;) await sleep(50, turn.signal);
  }
  if (turn.text.includes('#quietbuild')) return 'end_turn';
  await turn.say(`Built it after ${priorPrompts(turn.sessionId)} earlier prompts.`);
  return 'end_turn';
}
