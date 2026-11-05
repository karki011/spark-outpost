import { randomUUID } from 'node:crypto';
import type { z } from 'zod';

export type BridgeAnswer =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; code: string; message: string };

export interface BridgePort<Message> {
  post(message: Message): void;
  subscribe(listener: (message: unknown) => void): void;
}

export interface BridgeClientConfig<Message, Failure extends Error> {
  port: BridgePort<Message>;
  timeoutMs: number;
  newId?: () => string;
  answer(raw: unknown): BridgeAnswer | null;
  results: Readonly<Record<string, z.ZodType>>;
  request(id: string, request: unknown): Message;
  cancel(id: string): Message;
  failure(code: string, message: string): Failure;
  timeoutMessage: string;
  invalidMessage: string;
}

interface Waiting<Failure> {
  op: string;
  resolve(result: unknown): void;
  reject(error: Failure): void;
}

export function createBridgeClient<Message, Failure extends Error>(
  config: BridgeClientConfig<Message, Failure>,
) {
  const newId = config.newId ?? randomUUID;
  const waiting = new Map<string, Waiting<Failure>>();

  config.port.subscribe((raw) => {
    const message = config.answer(raw);
    if (!message) return;
    const entry = waiting.get(message.id);
    if (!entry) return;
    waiting.delete(message.id);
    if (!message.ok) {
      entry.reject(config.failure(message.code, message.message));
      return;
    }
    const result = config.results[entry.op]!.safeParse(message.result);
    if (result.success) entry.resolve(result.data);
    else entry.reject(config.failure('invalid', config.invalidMessage));
  });

  return function request(request: { op: string }, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(config.failure('cancelled', 'Cancelled.'));
    const id = newId();
    return new Promise((resolve, reject) => {
      const giveUp = (error: Failure) => {
        if (!waiting.delete(id)) return;
        config.port.post(config.cancel(id));
        reject(error);
      };
      const timer = setTimeout(
        () => giveUp(config.failure('timeout', config.timeoutMessage)),
        config.timeoutMs,
      );
      const onAbort = () => giveUp(config.failure('cancelled', 'Cancelled.'));
      signal?.addEventListener('abort', onAbort, { once: true });
      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      waiting.set(id, {
        op: request.op,
        resolve: (result) => {
          settle();
          resolve(result);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      });
      config.port.post(config.request(id, request));
    });
  };
}
