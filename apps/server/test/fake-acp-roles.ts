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

function sessionPrompts(turn: RoleTurn): string[] {
  try {
    return readFakeSession(turn.sessionId).prompts;
  } catch {
    return [turn.text];
  }
}

function leanMarker(text: string): string {
  return text.includes('## Build style: lean') && text.includes('#leanmark')
    ? '// lean: fixed list; upgrade: load from config when asked\n'
    : '';
}

export const BUG_FINDINGS = [
  '`notes.txt:2`: `"((5.00)"` is accepted because `hasParens` only looks at the first and last characters; it should throw.',
  "Critical regression: an unconditional `Math.abs` turns `-$5.00` positive, so `parseCents('-$5.00')` returns 500.",
];

export const STYLE_FINDINGS = [
  'Nit: `parseCents` could be named `toCents` to match the other helpers.',
  'Consider extracting the parentheses check into a named constant for readability.',
];

export const ROUND_FINDINGS = [
  BUG_FINDINGS[0]!,
  BUG_FINDINGS[1]!,
  '`(+$5)` is accepted when a plus sign inside parentheses should be rejected.',
  "`parseCents('$1,000.00')` returns 1 instead of 100000.",
];

export const HARDENING_FINDINGS = [
  '`apps/web/src/analytics/spend-csv.ts:13`: Project names can begin with `=`, `+`, `-`, or `@`, and the export writes them as spreadsheet formulas. CSV quoting does not prevent formula execution when the file is opened in a spreadsheet.',
  '`apps/web/src/analytics/SpendTab.tsx:65`: The blob URL is revoked immediately after `link.click()`. Browsers that start the download asynchronously may lose access to the file; revoke it after the download has started.',
  '`apps/web/src/analytics/spend-csv.ts:7`: A field containing `\\r` is left unquoted. Some CSV readers treat it as a row break, which can corrupt the exported rows.',
];

const ASKED_TO_FIX = '## Findings the Builder was asked to fix';

function reviewNumber(text: string): number {
  const start = text.indexOf(ASKED_TO_FIX);
  if (start === -1) return 1;
  const asked = text.slice(start, text.indexOf('\n## ', start + ASKED_TO_FIX.length));
  const last = ROUND_FINDINGS.findLastIndex((finding) => asked.includes(finding));
  return last + 2;
}

function roundFindings(text: string): string[] {
  const rounds = Number(/#bugrounds (\d+)/.exec(text)?.[1] ?? 0);
  const review = reviewNumber(text);
  if (review > rounds) return [];
  return [ROUND_FINDINGS[(review - 1) % ROUND_FINDINGS.length]!];
}

function reviewFindings(text: string): { findings: string[]; concerns: boolean } {
  const rechecking = text.includes(ASKED_TO_FIX);
  if (text.includes('#stuckreview')) return { findings: BUG_FINDINGS, concerns: true };
  if (text.includes('#bugrounds')) {
    const findings = roundFindings(text);
    if (findings.length > 0) return { findings, concerns: true };
  } else if (text.includes('#bugreview') && !rechecking) {
    return { findings: BUG_FINDINGS, concerns: true };
  }
  if (text.includes('#stylereview')) return { findings: STYLE_FINDINGS, concerns: true };
  if (text.includes('#hardeningreview')) return { findings: HARDENING_FINDINGS, concerns: true };
  if (text.includes('#concerns')) {
    return { findings: ['The divider test is missing'], concerns: true };
  }
  return { findings: ['The change matches the request'], concerns: false };
}

export async function critic(turn: RoleTurn): Promise<acp.StopReason> {
  const { findings, concerns } = reviewFindings(turn.text);
  const lens = turn.text.includes('## Complexity (same review)')
    ? '- notes.txt:L2: shrink: two lines say the same\nnet: -2 lines possible\n'
    : '';
  const bullets = findings.map((finding) => `- ${finding}\n`).join('');
  await turn.say(`Findings:\n${bullets}${lens}Verdict: ${concerns ? 'concerns' : 'looks good'}`);
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

function stopped(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
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

async function repeatUntilStopped(turn: RoleTurn): Promise<void> {
  if (!turn.text.includes('#repeat')) return;
  for (let index = 0; ; index += 1) {
    await readTool(turn, 'src/dates.ts', `repeat-${index}`);
    await sleep(20, turn.signal);
  }
}

const SPEND_CALLS = 7;

async function spend(turn: RoleTurn): Promise<void> {
  for (let call = 0; call < SPEND_CALLS; call += 1) {
    const context = 2_000 + call * 2_000;
    await turn.update({ sessionUpdate: 'usage_update', used: context, size: 200_000 });
    await turn.update({ sessionUpdate: 'usage_update', used: context + 500, size: 200_000 });
    await readTool(turn, `src/part-${call}.ts`, `spend-${call}`);
    await sleep(30, turn.signal);
  }
  await stopped(turn.signal);
}

const METER_CALLS = 20;
export const METER_CALL_USD = 0.03;

async function meter(turn: RoleTurn): Promise<void> {
  for (let call = 1; call <= METER_CALLS; call += 1) {
    const cost = { amount: METER_CALL_USD * call, currency: 'USD' };
    await turn.update({ sessionUpdate: 'usage_update', used: call * 1_000, size: 200_000, cost });
    await readTool(turn, `src/meter-${call}.ts`, `meter-${call}`);
    await sleep(100, turn.signal);
  }
}

async function editAfterLoop(turn: RoleTurn): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await readTool(turn, 'src/dates.ts', `loop-${index}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  await write(turn, 'notes.txt', 'edited after the loop');
  await stopped(turn.signal);
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
  await repeatUntilStopped(turn);
  if (turn.text.includes('#loopedit')) await editAfterLoop(turn);
  if (turn.text.includes('#meter')) await meter(turn);
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
  if (turn.text.includes('#feature') || turn.text.includes('#story')) {
    await write(turn, 'export.ts', 'export const csv = 1;');
    await write(turn, 'button.ts', 'export const button = 1;');
  }
  if (turn.text.includes('#story')) await write(turn, 'schema.sql', 'ALTER TABLE t ADD c int;');
  if (turn.text.includes('#addmigration')) {
    await write(
      turn,
      '004_project_tags.sql',
      'CREATE TABLE project_tags (project_id int, tag text);',
    );
  }
  if (turn.text.includes('#dropmigration')) {
    await write(turn, '005_drop_note.sql', 'ALTER TABLE projects DROP COLUMN note;');
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

async function fixFindings(turn: RoleTurn): Promise<acp.StopReason> {
  await write(turn, 'notes.txt', 'fixed the review findings');
  const prompts = sessionPrompts(turn);
  if (prompts.some((prompt) => prompt.includes('#fixcost'))) {
    const cost = { amount: 0.2, currency: 'USD' };
    await turn.update({ sessionUpdate: 'usage_update', used: 1_000, size: 200_000, cost });
  }
  if (prompts.some((prompt) => prompt.includes('#slowfix'))) {
    for (;;) await sleep(50, turn.signal);
  }
  await turn.say(
    `Fixed the review findings after ${priorPrompts(turn.sessionId)} earlier prompts.`,
  );
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
  if (text.includes('The AI review of your change found')) return fixFindings;
  if (text.includes('An independent check of your change')) return finishMissing;
  if (text.includes('Role: Critic.')) return critic;
  if (text.includes("The project's checks failed")) return fixChecks;
  if (text.includes('#build')) return builder;
  return null;
}
