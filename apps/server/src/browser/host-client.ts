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
import { createMacHostClient, type MacHost } from '../mac-control/host-client.ts';
import { createBridgeClient } from './bridge-client.ts';

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

export function createBrowserHostClient(options: BrowserHostClientOptions): BrowserHost {
  const request = createBridgeClient({
    port: options.port,
    timeoutMs: options.timeoutMs ?? BROWSER_REQUEST_TIMEOUT_MS,
    ...(options.newId ? { newId: options.newId } : {}),
    answer: (raw) => {
      const parsed = browserBridgeFromHostSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    results: browserHostResultSchemas,
    request: (id, sent) => ({ kind: 'browser:request', id, request: sent }) as BrowserBridgeToHost,
    cancel: (id) => ({ kind: 'browser:cancel', id }) as const,
    failure: (code, message) => new BrowserHostError(code as BrowserHostError['code'], message),
    timeoutMessage: 'The browser took too long to answer.',
    invalidMessage: 'The browser sent an answer Spark cannot read.',
  });
  return {
    request: (sent, signal) => request(sent, signal) as never,
  };
}

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface DesktopBrowser {
  host: BrowserHost;
  mac: MacHost;
  blockPorts(ports: readonly number[]): void;
}

export function connectDesktopBrowser(
  env: NodeJS.ProcessEnv,
  owner: object,
): DesktopBrowser | null {
  const parent = (owner as { parentPort?: ParentPort }).parentPort;
  if (env[BROWSER_HOST_ENV] !== '1' || !parent) return null;
  const port = {
    post: (message: unknown) => parent.postMessage(message),
    subscribe: (listener: (message: unknown) => void) =>
      parent.on('message', (event) => listener(event.data)),
  };
  return {
    host: createBrowserHostClient({ port }),
    mac: createMacHostClient({ port }),
    blockPorts: (ports) => port.post({ kind: 'browser:ports', ports: [...ports] }),
  };
}
