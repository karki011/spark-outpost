import type { ModePosture } from '@spark-outpost/contracts';
import type { DecideOptions, RequestRoot } from './decide.ts';
import type { FileLister } from './file-lister.ts';
import { parseShell } from './shell-parse.ts';
import { decideSparkCommand, sparkCommandRequest, type SparkCommandTurn } from './spark-command.ts';

export const ROOT = '/work/app';
export const HOME = '/Users/me';
export const noFiles: FileLister = { glob: () => [], walk: () => [], script: () => null };

export function turn(change: Partial<SparkCommandTurn> = {}): SparkCommandTurn {
  return {
    runMode: 'do',
    posture: 'full_access',
    role: null,
    piece: null,
    readOnly: false,
    roots: [{ path: ROOT, ignore: [] }],
    home: HOME,
    agentMode: null,
    ...change,
  };
}

export function inPosture(posture: ModePosture, roots?: readonly RequestRoot[]): SparkCommandTurn {
  return turn({ posture, ...(roots ? { roots } : {}) });
}

export function request(command: string, on: SparkCommandTurn = turn(), cwd: string | null = null) {
  return sparkCommandRequest(on, { toolCallId: 'call-1', command, cwd });
}

export async function decided(
  command: string,
  on: SparkCommandTurn = turn(),
  options: DecideOptions = {},
) {
  const shell = await parseShell(command);
  return decideSparkCommand(on, request(command, on), { files: noFiles, ...options, shell });
}
