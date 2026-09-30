import { writeFile } from 'node:fs/promises';
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
const HOLD_MS: Record<string, number> = { P1: 700, P2: 1_400 };

function parallelPieces(text: string): ParallelPiece[] {
  const migrations = text.includes('#migrations');
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
      ],
      dependsOn: [],
      size: 'L',
    },
    { key: 'P3', title: 'View', owns: ['view.ts'], dependsOn: ['P1'], size: 'S' },
  ];
}

export function parallelBlock(text: string) {
  if (!text.includes('#parallel')) return null;
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

async function spendContext(turn: RoleTurn): Promise<void> {
  await turn.update({ sessionUpdate: 'usage_update', used: 100_000, size: 200_000 });
  await turn.update({
    sessionUpdate: 'tool_call',
    toolCallId: 'budget-read',
    title: 'Read store.ts',
    kind: 'read',
    status: 'completed',
  });
}

export async function pieceExtras(turn: RoleTurn, key: string): Promise<void> {
  const tagged = (tag: string) => turn.text.includes(tag);
  const firstTurn = !turn.text.includes(RESUMED) && !turn.text.includes('checks failed');
  const hold = HOLD_MS[key];
  if (tagged('#parallel') && hold && firstTurn) await pause(hold, turn.signal);
  if (tagged('#slowpieces') && key !== 'P3') await untilStopped(turn.signal);
  if (tagged('#piecebudget') && key !== 'P3' && firstTurn) {
    if (key === 'P1') await spendContext(turn);
    await untilStopped(turn.signal);
  }
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
