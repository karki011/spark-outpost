import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

export interface Started {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

export interface ProcessSpec {
  name: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logs: string;
}

const RECENT_OUTPUT = 4_000;
const START_WITHIN_MS = 90_000;
const START_POLL_MS = 250;
const KILL_AFTER_MS = 8_000;

export function startProcess(spec: ProcessSpec): Started {
  const child = spawn(process.execPath, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(join(spec.logs, `${spec.name}.log`), { flags: 'a' });
  let recent = '';
  const keep = (chunk: Buffer) => {
    log.write(chunk);
    recent = (recent + chunk.toString()).slice(-RECENT_OUTPUT);
  };
  child.stdout!.on('data', keep);
  child.stderr!.on('data', keep);
  const exited = new Promise<number | null>((done) => child.once('exit', done));
  return { child, output: () => recent, exited };
}

export async function waitUntil(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + START_WITHIN_MS;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((done) => setTimeout(done, START_POLL_MS));
  }
  throw new Error(`${what} did not start within ${START_WITHIN_MS / 1000} s.`);
}

export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS);
  await exited;
  clearTimeout(timer);
}
