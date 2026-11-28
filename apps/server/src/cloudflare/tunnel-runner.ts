import { spawn, type ChildProcess } from 'node:child_process';

export type TunnelState = 'off' | 'starting' | 'running' | 'stopped';

export interface TunnelRunner {
  state(): TunnelState;
  start(token: string): Promise<boolean>;
  stop(): void;
}

export interface TunnelRunnerDeps {
  bin: string;
  spawn?: typeof spawn;
  readyMs?: number;
  retryMs?: number[];
}

const CONNECTED = /Registered tunnel connection/;
const READY_MS = 45_000;
const RETRY_MS = [5_000, 15_000, 60_000];

export function createTunnelRunner(deps: TunnelRunnerDeps): TunnelRunner {
  const launch = deps.spawn ?? spawn;
  const readyMs = deps.readyMs ?? READY_MS;
  const retryMs = deps.retryMs ?? RETRY_MS;
  let state: TunnelState = 'off';
  let child: ChildProcess | null = null;
  let wanted: string | null = null;
  let failures = 0;
  let retry: NodeJS.Timeout | null = null;

  const run = (token: string, onConnected: () => void) => {
    state = 'starting';
    const started = launch(deps.bin, ['tunnel', '--no-autoupdate', 'run'], {
      env: { ...process.env, TUNNEL_TOKEN: token },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child = started;
    const deadline = setTimeout(() => {
      if (child === started && state === 'starting') started.kill('SIGTERM');
    }, readyMs);
    deadline.unref();
    started.stderr?.setEncoding('utf8');
    started.stderr?.on('data', (text: string) => {
      if (child !== started || state === 'running' || !CONNECTED.test(text)) return;
      state = 'running';
      failures = 0;
      onConnected();
    });
    const ended = () => {
      clearTimeout(deadline);
      if (child !== started) return;
      child = null;
      state = wanted === null ? 'off' : 'stopped';
      if (wanted === null) return;
      const wait = retryMs[Math.min(failures, retryMs.length - 1)] ?? 60_000;
      failures += 1;
      const again = wanted;
      retry = setTimeout(() => {
        retry = null;
        if (wanted === again) run(again, () => undefined);
      }, wait);
      retry.unref();
    };
    started.once('error', ended);
    started.once('exit', ended);
  };

  const halt = () => {
    wanted = null;
    if (retry) clearTimeout(retry);
    retry = null;
    const running = child;
    child = null;
    running?.kill('SIGTERM');
    state = 'off';
  };

  return {
    state: () => state,
    stop: halt,
    start(token) {
      if (wanted === token && state === 'running') return Promise.resolve(true);
      halt();
      wanted = token;
      failures = 0;
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), readyMs);
        timer.unref();
        run(token, () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
    },
  };
}
