import { setTimeout as delay } from 'node:timers/promises';

export interface Supervised {
  exited: Promise<number | null>;
  stop(): Promise<void>;
}

export interface Backoff {
  initialMs: number;
  maxMs: number;
  stableMs: number;
  maxFailures: number;
}

export const DEFAULT_BACKOFF: Backoff = {
  initialMs: 500,
  maxMs: 30_000,
  stableMs: 60_000,
  maxFailures: 5,
};

export interface SupervisorOptions {
  start: () => Supervised;
  backoff?: Backoff;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onRestart?: (delayMs: number, code: number | null) => void;
  onGiveUp?: (code: number | null) => void;
}

export function backoffDelay(failures: number, backoff: Backoff): number {
  return Math.min(backoff.initialMs * 2 ** (failures - 1), backoff.maxMs);
}

async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  await delay(ms, undefined, { signal }).catch(() => undefined);
}

export class Supervisor {
  private readonly options: SupervisorOptions;
  private readonly backoff: Backoff;
  private readonly stopping = new AbortController();
  private current: Supervised | null = null;
  private loop: Promise<void> | null = null;

  constructor(options: SupervisorOptions) {
    this.options = options;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
  }

  start(): void {
    this.loop ??= this.run();
  }

  async stop(): Promise<void> {
    this.stopping.abort();
    await this.current?.stop();
    await this.loop;
  }

  private async run(): Promise<void> {
    const now = this.options.now ?? Date.now;
    const sleep = this.options.sleep ?? abortableSleep;
    let failures = 0;
    while (!this.stopping.signal.aborted) {
      const startedAt = now();
      this.current = this.options.start();
      const code = await this.current.exited;
      this.current = null;
      if (this.stopping.signal.aborted) return;
      failures = now() - startedAt >= this.backoff.stableMs ? 1 : failures + 1;
      if (failures > this.backoff.maxFailures) {
        this.options.onGiveUp?.(code);
        return;
      }
      const wait = backoffDelay(failures, this.backoff);
      this.options.onRestart?.(wait, code);
      await sleep(wait, this.stopping.signal);
    }
  }
}
