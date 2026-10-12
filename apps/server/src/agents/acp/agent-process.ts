import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { isAlive, killProcessTree, processTreeNow } from '../../terminal/process-group.ts';
import type { ProtocolObserver } from '../../providers/provider.ts';
import type { AgentLaunch } from './agents.ts';
import { tapStream } from './protocol-tap.ts';

const STDERR_TAIL_BYTES = 4_000;

export class AgentExitedError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
  ) {
    super(`Agent process exited (code ${exitCode ?? 'none'}, signal ${signal ?? 'none'}).`);
  }
}

function killOrphans(pids: readonly number[]): void {
  for (const pid of pids.filter((candidate) => isAlive(candidate))) killProcessTree(pid);
}

export interface AgentProcess {
  stream: acp.Stream;
  exited: Promise<never>;
  stderrTail(): string;
  stopping(): void;
  kill(): void;
}

export function startAgentProcess(
  launch: AgentLaunch,
  cwd: string,
  env: Record<string, string>,
  observer?: ProtocolObserver,
): AgentProcess {
  const child: ChildProcessWithoutNullStreams = spawn(launch.command, launch.args, {
    cwd,
    env: { ...env, ...launch.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
    observer?.stderr(chunk);
  });
  child.stdin.on('error', () => undefined);
  const exited = new Promise<never>((_, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new AgentExitedError(code, signal)));
  });
  exited.catch(() => undefined);
  let killed = false;
  let startedBeforeStop: number[] = [];
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  return {
    stream: observer ? tapStream(stream, observer) : stream,
    exited,
    stderrTail: () => stderr,
    stopping() {
      if (child.pid !== undefined && !killed) startedBeforeStop = processTreeNow(child.pid);
    },
    kill() {
      if (killed || child.pid === undefined) return;
      killed = true;
      const running = child.exitCode === null && child.signalCode === null;
      if (running) killProcessTree(child.pid, undefined, undefined, startedBeforeStop);
      else killOrphans(startedBeforeStop);
    },
  };
}
