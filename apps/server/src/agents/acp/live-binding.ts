import type * as acp from '@agentclientprotocol/sdk';
import type { ProviderAccount } from '@spark-outpost/contracts';
import type { ProtocolObserver, RequestUsage } from '../../providers/provider.ts';

export interface TurnHandlers {
  permission(
    params: acp.RequestPermissionRequest,
    requestId: string | number | null | undefined,
  ): Promise<acp.RequestPermissionResponse>;
  write(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse>;
  read(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse>;
  account(account: ProviderAccount): void;
  request(usage: RequestUsage): void;
  audit: ProtocolObserver | undefined;
}

export interface BindingSlot {
  current(): TurnHandlers | null;
  handlers(): Promise<TurnHandlers>;
  bind(handlers: TurnHandlers): () => void;
  close(reason: Error): void;
}

export function createBindingSlot(unbound: () => void): BindingSlot {
  let bound: TurnHandlers | null = null;
  let waiters: { resolve: (handlers: TurnHandlers) => void; reject: (error: Error) => void }[] = [];
  let closed: Error | null = null;
  return {
    current: () => bound,
    handlers() {
      if (bound) return Promise.resolve(bound);
      if (closed) return Promise.reject(closed);
      const waiting = new Promise<TurnHandlers>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
      unbound();
      return waiting;
    },
    bind(handlers) {
      if (bound) throw new Error('The live agent session is already bound to a run.');
      bound = handlers;
      const ready = waiters;
      waiters = [];
      for (const waiter of ready) waiter.resolve(handlers);
      return () => {
        if (bound === handlers) bound = null;
      };
    },
    close(reason) {
      closed = reason;
      bound = null;
      const left = waiters;
      waiters = [];
      for (const waiter of left) waiter.reject(reason);
    },
  };
}

export class ReleasedRead extends Error {
  constructor() {
    super('The read was released by the run that made it.');
  }
}

export interface MessageQueue<T> {
  push(item: T): void;
  next(): Promise<T>;
  release(): void;
  size(): number;
  fail(error: Error): void;
}

export function createMessageQueue<T>(): MessageQueue<T> {
  const items: T[] = [];
  let waiter: { resolve: (item: T) => void; reject: (error: Error) => void } | null = null;
  let failure: Error | null = null;
  return {
    push(item) {
      if (failure) return;
      if (waiter) {
        const taking = waiter;
        waiter = null;
        taking.resolve(item);
        return;
      }
      items.push(item);
    },
    next() {
      const first = items.shift();
      if (first !== undefined) return Promise.resolve(first);
      if (failure) return Promise.reject(failure);
      waiter?.reject(new ReleasedRead());
      return new Promise<T>((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    release() {
      waiter?.reject(new ReleasedRead());
      waiter = null;
    },
    size: () => items.length,
    fail(error) {
      failure = error;
      waiter?.reject(error);
      waiter = null;
    },
  };
}

const HELD_AUDIT_LIMIT = 2_000;

export interface ReboundObserver {
  observer: ProtocolObserver;
  bind(target: ProtocolObserver | undefined): void;
  unbind(): void;
}

export function reboundObserver(): ReboundObserver {
  let target: ProtocolObserver | undefined;
  let bound = false;
  const held: ((to: ProtocolObserver) => void)[] = [];
  const send = (deliver: (to: ProtocolObserver) => void) => {
    if (bound) {
      if (target) deliver(target);
      return;
    }
    if (held.length < HELD_AUDIT_LIMIT) held.push(deliver);
  };
  return {
    observer: {
      message: (direction, message, marks) => send((to) => to.message(direction, message, marks)),
      stderr: (chunk) => send((to) => to.stderr(chunk)),
    },
    bind(next) {
      target = next;
      bound = true;
      const waiting = held.splice(0);
      if (next) for (const deliver of waiting) deliver(next);
    },
    unbind() {
      target = undefined;
      bound = false;
    },
  };
}
