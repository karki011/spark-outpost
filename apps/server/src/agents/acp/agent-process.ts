import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { killProcessTree } from '../../terminal/process-group.ts';
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

export interface AgentProcess {
  stream: acp.Stream;
  exited: Promise<never>;
  stderrTail(): string;
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
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );
  return {
    stream: observer ? tapStream(stream, observer) : stream,
    exited,
    stderrTail: () => stderr,
    kill() {
      if (killed || child.pid === undefined) return;
      killed = true;
      if (child.exitCode === null && child.signalCode === null) killProcessTree(child.pid);
    },
  };
}
