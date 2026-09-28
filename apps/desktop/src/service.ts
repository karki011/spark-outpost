import { setTimeout as delay } from 'node:timers/promises';
import { utilityProcess } from 'electron';
import type { Supervised } from './supervisor.ts';

const STOP_TIMEOUT_MS = 10_000;
const TAIL_LINES = 40;

export interface ServiceOptions {
  name: string;
  bootstrap: string;
  entry: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}

export class OutputTail {
  private readonly lines: string[] = [];

  push(chunk: string): string[] {
    const added = chunk.split('\n').filter((line) => line.trim() !== '');
    this.lines.push(...added);
    this.lines.splice(0, Math.max(0, this.lines.length - TAIL_LINES));
    return added;
  }

  text(): string {
    return this.lines.join('\n');
  }
}

export function forkService(options: ServiceOptions, tail: OutputTail): Supervised {
  const child = utilityProcess.fork(options.bootstrap, [options.entry], {
    cwd: options.cwd,
    env: options.env,
    stdio: 'pipe',
    serviceName: options.name,
  });
  const record = (chunk: Buffer) => {
    for (const line of tail.push(chunk.toString('utf8'))) options.log(line);
  };
  child.stdout?.on('data', record);
  child.stderr?.on('data', record);
  let running = true;
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      running = false;
      resolve(code);
    });
  });
  return {
    exited,
    async stop() {
      if (!running) return;
      child.kill();
      await Promise.race([exited, delay(STOP_TIMEOUT_MS)]);
      if (running && child.pid) process.kill(child.pid, 'SIGKILL');
      await exited;
    },
  };
}
