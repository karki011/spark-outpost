import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type RunFile = (file: string, args: readonly string[]) => string;

const SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';
const SID = /"(S-1-5-[\d-]+)"\s*$/;

function system32(env: NodeJS.ProcessEnv): string {
  return path.win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32');
}

const runFile: RunFile = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 });

export function userSid(whoamiOutput: string): string | null {
  return SID.exec(whoamiOutput.trim())?.[1] ?? null;
}

export function privateFolderArgs(folder: string, sid: string): string[] {
  const grant = (id: string) => ['/grant:r', `*${id}:(OI)(CI)F`];
  return [
    folder,
    '/inheritance:r',
    ...grant(sid),
    ...grant(SYSTEM_SID),
    ...grant(ADMINISTRATORS_SID),
  ];
}

export function makeFolderPrivate(
  folder: string,
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; run?: RunFile } = {},
): void {
  if ((options.platform ?? process.platform) !== 'win32') return;
  const env = options.env ?? process.env;
  const run = options.run ?? runFile;
  const tools = system32(env);
  const sid = userSid(run(path.win32.join(tools, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']));
  if (!sid) throw new Error('Could not read the Windows user id');
  run(path.win32.join(tools, 'icacls.exe'), privateFolderArgs(folder, sid));
}

export function makeDataFolderPrivate(folder: string, log: (line: string) => void): void {
  if (process.platform !== 'win32') return;
  try {
    mkdirSync(folder, { recursive: true });
    makeFolderPrivate(folder);
  } catch (error) {
    log(`Could not make the data folder private: ${(error as Error).message}`);
  }
}
