import type { SteerRequests } from '../../providers/provider.ts';

export interface IdleInbox {
  open(): void;
  close(): void;
  offer(text: string): boolean;
  arrived(): Promise<void>;
  take(): string | null;
}

export function createIdleInbox(): IdleInbox {
  const waiting: string[] = [];
  let accepting = false;
  let wake: (() => void) | null = null;
  return {
    open() {
      accepting = true;
    },
    close() {
      accepting = false;
    },
    offer(text) {
      if (!accepting) return false;
      waiting.push(text);
      wake?.();
      wake = null;
      return true;
    },
    arrived() {
      if (waiting.length > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        wake = resolve;
      });
    },
    take() {
      return waiting.shift() ?? null;
    },
  };
}

export function deliveringWhenIdle(
  steering: SteerRequests | undefined,
  inbox: IdleInbox,
): SteerRequests | undefined {
  if (!steering) return undefined;
  return {
    attach: (send) => steering.attach(async (text) => inbox.offer(text) || send(text)),
  };
}
