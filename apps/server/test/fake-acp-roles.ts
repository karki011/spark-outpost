import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { readFakeSession } from './fake-acp-sessions.ts';

export const FAKE_PLAN_FILES = ['src/dates.ts', 'src/divider.tsx', 'src/turns.ts'];

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

function planStep(file: string, index: number, text: string): string {
  if (text.includes('#research') && index < 2) {
    return `Research: how ${file} is used [parallel R]`;
  }
  const tagged = text.includes('#parallel') && !text.includes('#parallelline');
  const tag = tagged && index > 0 ? ' [parallel A]' : '';
  return `Update ${file} for step ${index + 1}${tag}`;
}

export async function architect(turn: RoleTurn): Promise<acp.StopReason> {
  const entries = FAKE_PLAN_FILES.map((file, index) => ({
    content: planStep(file, index, turn.text),
    priority: index === 0 ? ('high' as const) : ('medium' as const),
    status: 'pending' as const,
  }));
  await turn.update({ sessionUpdate: 'plan', entries });
  const edited = /Change requested by the user\n(.+)/.exec(turn.text)?.[1];
  const hint = turn.text.includes('#parallelline') ? '\n\nParallel: 2, 3' : '';
  const large =
    turn.text.includes('#parallel') && !turn.text.includes('#small') ? '\nLarge: 2, 3' : '';
  const notes = '\n\nNotes for Builders:\nsrc/dates.ts exports formatDay(date: Date): string.';
  const chains = turn.text.includes('#chains')
    ? '\n\nStep 1 · Files: src/dates.ts · Depends on: none\nStep 2 · Files: src/divider.tsx · Depends on: 1\nStep 3 · Files: src/turns.ts · Depends on: none\nChain A: steps 1-2\nChain B: step 3'
    : '';
  await turn.say(
    `Plan ready with ${entries.length} steps.${edited ? ` Edited: ${edited}` : ''}${chains}${notes}${hint}${large}`,
  );
  return 'end_turn';
}

export async function scout(turn: RoleTurn): Promise<acp.StopReason> {
  const question = /## Your question\n(.+)/.exec(turn.text)?.[1] ?? 'the request';
  if (turn.text.includes('#slowscout')) {
    for (;;) await sleep(50, turn.signal);
  }
  await turn.say(`Found: ${question}`);
  return 'end_turn';
}

function priorPrompts(sessionId: string): number {
  try {
    return readFakeSession(sessionId).prompts.length - 1;
  } catch {
    return 0;
  }
}

export async function critic(turn: RoleTurn): Promise<acp.StopReason> {
  const concerns = turn.text.includes('#concerns');
  const reviewed = `Reviews in this session: ${priorPrompts(turn.sessionId) + 1}.\n`;
  await turn.say(
    reviewed +
      (concerns
        ? 'Findings:\n- The divider test is missing\nVerdict: concerns'
        : 'Findings:\n- The change matches the plan\nVerdict: looks good'),
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

async function failWhenAsked(turn: RoleTurn, step: string): Promise<void> {
  if (new RegExp(`#failstep ${step}\\b`).test(turn.text)) throw new Error(`Step ${step} broke.`);
  if (!new RegExp(`#failonce ${step}\\b`).test(turn.text)) return;
  const root = turn.cwd.split('/.spark/worktrees/')[0]!;
  const marker = join(root, '.git', `failed-step-${step}`);
  if (await current(marker)) return;
  await writeFile(marker, 'failed');
  throw new Error(`Step ${step} broke once.`);
}

function targetFile(turn: RoleTurn, line: string): string {
  const named = /(src\/[\w.]+)/.exec(line)?.[1];
  const ownFile =
    (turn.text.includes('#parallel') || turn.text.includes('#chains')) &&
    !turn.text.includes('#collide');
  return ownFile && named ? named : 'notes.txt';
}

async function reconcile(turn: RoleTurn): Promise<acp.StopReason> {
  const target = join(turn.cwd, 'notes.txt');
  const before = await current(target);
  await turn.client.request(acp.methods.client.fs.writeTextFile, {
    sessionId: turn.sessionId,
    path: target,
    content: `${before}reconciled\n`,
  });
  await turn.say('Reconciled both changes.');
  return 'end_turn';
}

function ownSteps(text: string): { step: string; line: string }[] {
  const steps = [...text.matchAll(/(\d+)\. ([^\n]*)<- your step/g)].map((match) => ({
    step: match[1]!,
    line: match[2]!,
  }));
  return steps.length > 0 ? steps : [{ step: '1', line: '' }];
}

export async function builder(turn: RoleTurn): Promise<acp.StopReason> {
  if (turn.text.includes('## Conflicting changes to reconcile')) return reconcile(turn);
  const steps = ownSteps(turn.text);
  for (const { step, line } of steps) {
    const stopped = await buildStep(turn, step, line, steps.length > 1);
    if (stopped) return stopped;
  }
  const clarified = /The user clarified: (.+)/.exec(turn.text)?.[1];
  const built = steps.map(({ step }) => step).join(', ');
  const notes = turn.text.includes('## Notes from the Architect') ? ' Read the notes.' : '';
  await turn.say(`Built step ${built}.${clarified ? ` Clarified: ${clarified}` : ''}${notes}`);
  return 'end_turn';
}

async function buildStep(
  turn: RoleTurn,
  step: string,
  line: string,
  marked: boolean,
): Promise<acp.StopReason | null> {
  await failWhenAsked(turn, step);
  const file = targetFile(turn, line);
  const target = join(turn.cwd, file);
  const before = await current(target);
  const toolCallId = `build-${step}`;
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
      content: `${before}step ${step}\n`,
    });
    await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
  } catch {
    await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'failed' });
    await turn.say(`Could not write step ${step}.`);
    return 'end_turn';
  }
  if (turn.text.includes('#push') && step === '1') await push(turn);
  if (turn.text.includes('#slowbuild') || turn.text.includes(`#slowstep ${step}`)) {
    for (;;) await sleep(50, turn.signal);
  }
  if (turn.text.includes(`#sleepstep ${step}`)) await sleep(1_500, turn.signal);
  if (marked) await turn.say(`Step ${step} done.\n`);
  return null;
}

export async function fixChecks(turn: RoleTurn): Promise<acp.StopReason> {
  const target = join(turn.cwd, 'fixed.txt');
  const toolCallId = 'fix-checks';
  await turn.update({
    sessionUpdate: 'tool_call',
    toolCallId,
    title: 'Write fixed.txt',
    kind: 'edit',
    status: 'pending',
  });
  await turn.client.request(acp.methods.client.fs.writeTextFile, {
    sessionId: turn.sessionId,
    path: target,
    content: 'fixed\n',
  });
  await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
  const earlier = priorPrompts(turn.sessionId);
  await turn.say(`Fixed the checks after ${earlier} earlier prompts in this session.`);
  return 'end_turn';
}

export function roleFor(text: string): ((turn: RoleTurn) => Promise<acp.StopReason>) | null {
  if (text.includes('Role: Architect.')) return architect;
  if (text.includes('Role: Critic.') || text.includes('Review the next change')) return critic;
  if (text.includes('Role: Scout.')) return scout;
  if (text.includes('## Failing checks')) return fixChecks;
  if (text.includes('#build')) return builder;
  return null;
}
