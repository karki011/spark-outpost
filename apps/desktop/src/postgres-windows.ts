import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type CommandRunner = (file: string, args: string[]) => Promise<void>;

const START_TIMEOUT_SECONDS = 60;
const LOG_TAIL_LINES = 8;

const defaultRunner: CommandRunner = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(file)} ${args[0]} exited with ${code}`));
    });
  });

export interface PgCtlOptions {
  pgCtl: string;
  dataDir: string;
  port: number;
  host: string;
  log: (line: string) => void;
  run?: CommandRunner;
}

export function pgCtlLogFile(dataDir: string): string {
  return path.join(dataDir, 'pg_ctl.log');
}

export function pgCtlStartArgs(dataDir: string, port: number, host: string): string[] {
  return [
    'start',
    '-D',
    dataDir,
    '-w',
    '-t',
    String(START_TIMEOUT_SECONDS),
    '-l',
    pgCtlLogFile(dataDir),
    '-o',
    `-p ${port} -c listen_addresses=${host}`,
  ];
}

export function pgCtlStopArgs(dataDir: string): string[] {
  return ['stop', '-D', dataDir, '-m', 'fast', '-w'];
}

async function logTail(dataDir: string): Promise<string> {
  try {
    const text = await readFile(pgCtlLogFile(dataDir), 'utf8');
    return text.trim().split(/\r?\n/).slice(-LOG_TAIL_LINES).join('\n');
  } catch {
    return '';
  }
}

export async function stopLeftoverWithPgCtl(options: PgCtlOptions): Promise<void> {
  const run = options.run ?? defaultRunner;
  try {
    await run(options.pgCtl, ['status', '-D', options.dataDir]);
  } catch {
    return;
  }
  options.log('Stopping Postgres left running by an earlier launch.');
  await run(options.pgCtl, pgCtlStopArgs(options.dataDir)).catch(() => undefined);
}

export async function startWithPgCtl(options: PgCtlOptions): Promise<() => Promise<void>> {
  const run = options.run ?? defaultRunner;
  const { pgCtl, dataDir } = options;
  try {
    await run(pgCtl, pgCtlStartArgs(dataDir, options.port, options.host));
  } catch (error) {
    const tail = await logTail(dataDir);
    if (tail) options.log(tail);
    throw new Error(`pg_ctl could not start Postgres${tail ? `: ${tail}` : ''}`, { cause: error });
  }
  return async () => {
    await run(pgCtl, pgCtlStopArgs(dataDir));
  };
}
