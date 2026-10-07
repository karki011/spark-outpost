import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import { write, type RoleTurn } from './fake-acp-roles.ts';

interface ParallelPiece {
  key: string;
  title: string;
  owns: string[];
  dependsOn: string[];
  size: 'S' | 'L';
}

const RESUMED = 'Continue where you stopped';
const HOLD_MS = 700;
const STORE_WAIT_MS = 30_000;

const SAME_FILE_PIECES: ParallelPiece[] = [
  { key: 'P1', title: 'Truncate', owns: ['strings.ts'], dependsOn: [], size: 'S' },
  { key: 'P2', title: 'Pad', owns: ['strings.ts'], dependsOn: ['P1'], size: 'S' },
];

function parallelPieces(text: string): ParallelPiece[] {
  if (text.includes('#samefile')) return SAME_FILE_PIECES;
  const migrations = text.includes('#migrations');
  const manifest = text.includes('#manifest');
  return [
    {
      key: 'P1',
      title: 'Store',
      owns: ['store.ts', ...(migrations ? ['migrations/0002_store.sql'] : [])],
      dependsOn: [],
      size: 'L',
    },
    {
      key: 'P2',
      title: 'API',
      owns: [
        'api.ts',
        'api-types.ts',
        'api-routes.ts',
        ...(migrations ? ['migrations/0002_api.sql'] : []),
        ...(manifest ? ['package.json'] : []),
      ],
      dependsOn: [],
      size: 'L',
    },
    { key: 'P3', title: 'View', owns: ['view.ts'], dependsOn: ['P1'], size: 'S' },
  ];
}

export function parallelBlock(text: string) {
  if (!text.includes('#parallel') && !text.includes('#samefile')) return null;
  return {
    pieces: parallelPieces(text).map((piece) => ({
      key: piece.key,
      title: piece.title,
      goal: `Build the ${piece.title.toLowerCase()}`,
      owns: piece.owns,
      reads: [],
      dependsOn: piece.dependsOn,
      contract: `${piece.title.toLowerCase()}(): string`,
      acceptance: [`${piece.owns[0]} exists`],
      checks: [`${process.execPath} piece-check.mjs ${piece.owns[0]}`],
      size: piece.size,
    })),
    integration: null,
  };
}

function untilStopped(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function ownedFiles(text: string): string[] {
  const section = /own these files[^\n]*\n((?:- \S+\n?)+)/.exec(text)?.[1] ?? '';
  return [...section.matchAll(/^- (\S+)$/gm)].map((match) => match[1]!);
}

function mainOfCopy(cwd: string): string {
  return resolve(cwd, '..', '..', '..');
}

async function builtStore(folder: string): Promise<boolean> {
  const text = await readFile(join(folder, 'store.ts'), 'utf8').catch(() => '');
  return text.includes('built by P1') || text.includes('reconciled');
}

async function afterStore(turn: RoleTurn): Promise<void> {
  const until = Date.now() + STORE_WAIT_MS;
  while (Date.now() < until && !turn.signal.aborted) {
    if ((await builtStore(turn.cwd)) || (await builtStore(mainOfCopy(turn.cwd)))) return;
    await pause(50, turn.signal);
  }
}

async function locatedEdit(turn: RoleTurn, file: string, line: string): Promise<void> {
  const target = join(turn.cwd, file);
  const toolCallId = `located-${file}`;
  await turn.update({
    sessionUpdate: 'tool_call',
    toolCallId,
    title: `Edit ${file}`,
    kind: 'edit',
    status: 'pending',
    locations: [{ path: target }],
  });
  await appendFile(target, `${line}\n`);
  await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
}

async function diffEdit(turn: RoleTurn, file: string, line: string): Promise<void> {
  const target = join(turn.cwd, file);
  const toolCallId = `diff-${file}`;
  const oldText = await readFile(target, 'utf8').catch(() => null);
  const newText = `${oldText ?? ''}${line}\n`;
  await turn.update({
    sessionUpdate: 'tool_call',
    toolCallId,
    title: 'Editing files',
    kind: 'edit',
    status: 'in_progress',
    content: [{ type: 'diff', path: target, oldText, newText }],
  });
  await writeFile(target, newText);
  await turn.update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'completed' });
}

export async function pieceExtras(turn: RoleTurn, key: string): Promise<void> {
  const tagged = (tag: string) => turn.text.includes(tag);
  const firstTurn = !turn.text.includes(RESUMED) && !turn.text.includes('checks failed');
  if (tagged('#parallel') && key === 'P1' && firstTurn) await pause(HOLD_MS, turn.signal);
  if (tagged('#crossedit') && key === 'P1' && firstTurn) {
    await locatedEdit(turn, 'api.ts', 'crossed by P1');
  }
  if (tagged('#crossdiff') && key === 'P1' && firstTurn) {
    await diffEdit(turn, 'api.ts', 'crossed by P1');
  }
  if (tagged('#parallel') && key === 'P2' && firstTurn) await afterStore(turn);
  if (tagged('#slowpieces') && key !== 'P3') await untilStopped(turn.signal);
  if (tagged('#useredit') && key === 'P1') {
    await writeFile(join(mainOfCopy(turn.cwd), 'store.ts'), 'user edit\n');
  }
  for (const file of ownedFiles(turn.text).filter((owned) => owned.includes('migrations/'))) {
    await write(turn, file, `-- ${key}`);
  }
}

export async function conflictTurn(turn: RoleTurn): Promise<acp.StopReason | null> {
  if (!turn.text.includes('could not merge cleanly')) return null;
  if (turn.text.includes('#unresolvable')) {
    await turn.say('Unresolved: both sides rewrote the same line for different reasons.');
    return 'end_turn';
  }
  const files = [...turn.text.matchAll(/^### (\S+)$/gm)].map((match) => match[1]!);
  for (const file of files) await write(turn, file, 'reconciled');
  await turn.say(`Kept both changes in ${files.join(', ')}.`);
  return 'end_turn';
}
