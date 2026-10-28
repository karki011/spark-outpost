import type { ProviderMessage, SteerRequests } from '../../providers/provider.ts';

export interface IdleInbox {
  open(): void;
  close(): void;
  offer(text: ProviderMessage): boolean;
  arrived(): Promise<void>;
  take(): ProviderMessage | null;
}

export function createIdleInbox(listening?: SteerRequests): IdleInbox {
  const waiting: ProviderMessage[] = [];
  let accepting = false;
  let wake: (() => void) | null = null;
  let stopListening: () => void = () => undefined;
  const offer = (text: ProviderMessage) => {
    if (!accepting) return false;
    waiting.push(text);
    wake?.();
    wake = null;
    return true;
  };
  return {
    open() {
      accepting = true;
      stopListening = listening?.attach(async (text) => offer(text)) ?? stopListening;
    },
    close() {
      accepting = false;
      stopListening();
      stopListening = () => undefined;
    },
    offer,
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
