import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  BROWSER_HOST_ENV,
  BROWSER_REQUEST_TIMEOUT_MS,
  browserBridgeFromHostSchema,
  browserHostResultSchemas,
  type BrowserBridgeToHost,
  type BrowserHostErrorCode,
  type BrowserHostOp,
  type BrowserHostRequest,
} from '@spark-outpost/contracts';

export type BrowserHostResult<Op extends BrowserHostOp> = z.infer<
  (typeof browserHostResultSchemas)[Op]
>;

export interface BrowserHost {
  request<Op extends BrowserHostOp>(
    request: Extract<BrowserHostRequest, { op: Op }>,
    signal?: AbortSignal,
  ): Promise<BrowserHostResult<Op>>;
}

export class BrowserHostError extends Error {
  readonly code: BrowserHostErrorCode | 'timeout' | 'invalid';

  constructor(code: BrowserHostErrorCode | 'timeout' | 'invalid', message: string) {
    super(message);
    this.code = code;
  }
}

export interface BrowserHostPort {
  post(message: BrowserBridgeToHost): void;
  subscribe(listener: (message: unknown) => void): void;
}

export interface BrowserHostClientOptions {
  port: BrowserHostPort;
  timeoutMs?: number;
  newId?: () => string;
}

interface Waiting {
  op: BrowserHostOp;
  resolve(result: unknown): void;
  reject(error: BrowserHostError): void;
}

export function createBrowserHostClient(options: BrowserHostClientOptions): BrowserHost {
  const { port } = options;
  const timeoutMs = options.timeoutMs ?? BROWSER_REQUEST_TIMEOUT_MS;
  const newId = options.newId ?? randomUUID;
  const waiting = new Map<string, Waiting>();

  port.subscribe((raw) => {
    const parsed = browserBridgeFromHostSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    const entry = waiting.get(message.id);
    if (!entry) return;
    waiting.delete(message.id);
    if (!message.ok) {
      entry.reject(new BrowserHostError(message.code, message.message));
      return;
    }
    const result = browserHostResultSchemas[entry.op].safeParse(message.result);
    if (result.success) entry.resolve(result.data);
    else
      entry.reject(
        new BrowserHostError('invalid', 'The browser sent an answer Spark cannot read.'),
      );
  });

  return {
    request(request, signal) {
      if (signal?.aborted) {
        return Promise.reject(new BrowserHostError('cancelled', 'Cancelled.'));
      }
      const id = newId();
      return new Promise((resolve, reject) => {
        const giveUp = (error: BrowserHostError) => {
          if (!waiting.delete(id)) return;
          port.post({ kind: 'browser:cancel', id });
          reject(error);
        };
        const timer = setTimeout(
          () => giveUp(new BrowserHostError('timeout', 'The browser took too long to answer.')),
          timeoutMs,
        );
        const onAbort = () => giveUp(new BrowserHostError('cancelled', 'Cancelled.'));
        signal?.addEventListener('abort', onAbort, { once: true });
        const settle = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        };
        waiting.set(id, {
          op: request.op,
          resolve: (result) => {
            settle();
            resolve(result as never);
          },
          reject: (error) => {
            settle();
            reject(error);
          },
        });
        port.post({ kind: 'browser:request', id, request });
      });
    },
  };
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface DesktopBrowser {
  host: BrowserHost;
  blockPorts(ports: readonly number[]): void;
}

export function connectDesktopBrowser(
  env: NodeJS.ProcessEnv,
  owner: object,
): DesktopBrowser | null {
  const parent = (owner as { parentPort?: ParentPort }).parentPort;
  if (env[BROWSER_HOST_ENV] !== '1' || !parent) return null;
  const port: BrowserHostPort = {
    post: (message) => parent.postMessage(message),
    subscribe: (listener) => parent.on('message', (event) => listener(event.data)),
  };
  return {
    host: createBrowserHostClient({ port }),
    blockPorts: (ports) => port.post({ kind: 'browser:ports', ports: [...ports] }),
  };
}
