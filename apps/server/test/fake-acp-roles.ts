import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { readFakeSession } from './fake-acp-sessions.ts';

type Update = (value: acp.SessionUpdate) => Promise<void>;
type Say = (chunk: string) => Promise<void>;

export interface RoleTurn {
  text: string;
  sessionId: string;
  cwd: string;
  client: acp.AgentContext;
  update: Update;
  say: Say;
  signal: AbortSignal;
}

export const FAKE_TODOS = ['Write the change', 'Add a test', 'Update the docs'];

async function readTool(turn: RoleTurn, file: string, id: string): Promise<void> {
  await turn.update({
    sessionUpdate: 'tool_call',
    toolCallId: id,
    title: `Read \`${file}\``,
    kind: 'read',
    locations: [{ path: file }],
    rawInput: { file_path: file },
    status: 'completed',
  });
}

function priorPrompts(sessionId: string): number {
  try {
    return readFakeSession(sessionId).prompts.length - 1;
  } catch {
    return 0;
  }
}

function leanMarker(text: string): string {
  return text.includes('## Build style: lean') && text.includes('#leanmark')
    ? '// lean: fixed list; upgrade: load from config when asked\n'
    : '';
}

export async function critic(turn: RoleTurn): Promise<acp.StopReason> {
  const concerns = turn.text.includes('#concerns');
  const lens = turn.text.includes('## Complexity (same review)')
    ? '- notes.txt:L2: shrink: two lines say the same\nnet: -2 lines possible\n'
    : '';
  await turn.say(
    concerns
      ? `Findings:\n- The divider test is missing\n${lens}Verdict: concerns`
      : `Findings:\n- The change matches the request\n${lens}Verdict: looks good`,
  );
  return 'end_turn';
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
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}

async function push(turn: RoleTurn): Promise<void> {
  const toolCall = {
    toolCallId: 'push-1',
    title: 'git push origin main',
    kind: 'execute' as const,
    status: 'pending' as const,
    rawInput: { command: 'git push origin main' },
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

async function failWhenAsked(turn: RoleTurn): Promise<void> {
  if (turn.text.includes('#failstep 1')) throw new Error('Step 1 broke.');
  if (!turn.text.includes('#failonce 1')) return;
  const root = turn.cwd.split('/.spark/worktrees/')[0]!;
  const marker = join(root, '.git', 'failed-step-1');
  if (await current(marker)) return;
  await writeFile(marker, 'failed');
  throw new Error('Step 1 broke once.');
}

async function todos(turn: RoleTurn, done: number): Promise<void> {
  await turn.update({
    sessionUpdate: 'plan',
    entries: FAKE_TODOS.map((content, index) => ({
      content,
      priority: 'medium' as const,
      status: index < done ? ('completed' as const) : ('pending' as const),
    })),
  });
}

async function repeat(turn: RoleTurn): Promise<void> {
  const count = Number(/#repeat (\d+)/.exec(turn.text)?.[1] ?? 0);
  for (let index = 0; index < count; index += 1) {
    await readTool(turn, 'src/dates.ts', `repeat-${index}`);
    await sleep(20, turn.signal);
  }
}

async function spend(turn: RoleTurn): Promise<void> {
  for (let call = 0; ; call += 1) {
    const context = 2_000 + call * 2_000;
    await turn.update({ sessionUpdate: 'usage_update', used: context, size: 200_000 });
    await turn.update({ sessionUpdate: 'usage_update', used: context + 500, size: 200_000 });
    await readTool(turn, `src/part-${call}.ts`, `spend-${call}`);
    await sleep(30, turn.signal);
  }
}

async function write(turn: RoleTurn, file: string, line: string): Promise<boolean> {
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
      content: `${before}${line}\n${leanMarker(turn.text)}`,
    });
    await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
    return true;
  } catch {
    await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' });
    await turn.say(`Could not write ${file}.`);
    return false;
  }
}

export async function builder(turn: RoleTurn): Promise<acp.StopReason> {
  await failWhenAsked(turn);
  await repeat(turn);
  const stopAfter = Number(/#stopafter (\d+)/.exec(turn.text)?.[1] ?? FAKE_TODOS.length);
  if (turn.text.includes('#todos')) await todos(turn, 0);
  if (!(await write(turn, 'notes.txt', 'step 1'))) return 'end_turn';
  if (turn.text.includes('#touchmain')) {
    const main = turn.cwd.split('/.spark/worktrees/')[0]!;
    await writeFile(join(main, 'notes.txt'), 'start\nyour own edit\n');
  }
  if (turn.text.includes('#bigdiff')) {
    await write(
      turn,
      'big.txt',
      Array.from({ length: 450 }, (_, index) => `line ${index}`).join('\n'),
    );
  }
  if (turn.text.includes('#push')) await push(turn);
  if (turn.text.includes('#spend')) await spend(turn);
  if (turn.text.includes('#slowbuild')) {
    for (;;) await sleep(50, turn.signal);
  }
  if (turn.text.includes('#todos')) await todos(turn, stopAfter);
  if (turn.text.includes('#cost')) {
    const cost = { amount: 0.2, currency: 'USD' };
    await turn.update({ sessionUpdate: 'usage_update', used: 1_000, size: 200_000, cost });
  }
  const clarified = /The user clarified: (.+)/.exec(turn.text)?.[1];
  const assumed = /assume the user means: (.+)/.exec(turn.text)?.[1];
  const heard = `${clarified ? ` Clarified: ${clarified}` : ''}${assumed ? ` Took it as: ${assumed}` : ''}`;
  await turn.say(`Built it after ${priorPrompts(turn.sessionId)} earlier prompts.${heard}`);
  return 'end_turn';
}

export async function fixChecks(turn: RoleTurn): Promise<acp.StopReason> {
  await write(turn, 'fixed.txt', 'fixed');
  await turn.say(`Fixed the checks after ${priorPrompts(turn.sessionId)} earlier prompts.`);
  return 'end_turn';
}

async function continueTodos(turn: RoleTurn): Promise<acp.StopReason> {
  await write(turn, 'notes.txt', 'continued');
  if (!turn.text.includes('#stuckplan')) await todos(turn, FAKE_TODOS.length);
  await turn.say(`Finished the open items after ${priorPrompts(turn.sessionId)} earlier prompts.`);
  return 'end_turn';
}

async function fixRequest(turn: RoleTurn): Promise<acp.StopReason> {
  await write(turn, 'notes.txt', 'fixed as asked');
  await turn.say(`Fixed it after ${priorPrompts(turn.sessionId)} earlier prompts.`);
  return 'end_turn';
}

async function finishMissing(turn: RoleTurn): Promise<acp.StopReason> {
  await write(turn, 'notes.txt', 'finished what was missing');
  await turn.say(
    `Finished what was missing after ${priorPrompts(turn.sessionId)} earlier prompts.`,
  );
  return 'end_turn';
}

async function unstick(turn: RoleTurn): Promise<acp.StopReason> {
  await write(turn, 'notes.txt', 'tried another way');
  await turn.say('Tried another way.');
  return 'end_turn';
}

export function roleFor(text: string): ((turn: RoleTurn) => Promise<acp.StopReason>) | null {
  if (text.includes('You stopped before finishing')) return continueTodos;
  if (text.includes('The harness stopped your last turn')) return unstick;
  if (text.includes('The user asked for a fix')) return fixRequest;
  if (text.includes('An independent check of your change')) return finishMissing;
  if (text.includes('Role: Critic.')) return critic;
  if (text.includes("The project's checks failed")) return fixChecks;
  if (text.includes('#build')) return builder;
  return null;
}
