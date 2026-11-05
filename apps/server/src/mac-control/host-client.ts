import type { z } from 'zod';
import {
  MAC_REQUEST_TIMEOUT_MS,
  macBridgeFromHostSchema,
  macHostResultSchemas,
  type MacBridgeToHost,
  type MacHostErrorCode,
  type MacHostOp,
  type MacHostRequest,
} from '@spark-outpost/contracts';
import { createBridgeClient, type BridgePort } from '../browser/bridge-client.ts';

export type MacHostResult<Op extends MacHostOp> = z.infer<(typeof macHostResultSchemas)[Op]>;

export interface MacHost {
  request<Op extends MacHostOp>(
    request: Extract<MacHostRequest, { op: Op }>,
    signal?: AbortSignal,
  ): Promise<MacHostResult<Op>>;
}

export type MacHostFailure = MacHostErrorCode | 'timeout' | 'invalid';

export class MacHostError extends Error {
  readonly code: MacHostFailure;

  constructor(code: MacHostFailure, message: string) {
    super(message);
    this.code = code;
  }
}

export interface MacHostClientOptions {
  port: BridgePort<MacBridgeToHost>;
  timeoutMs?: number;
  newId?: () => string;
}

export function createMacHostClient(options: MacHostClientOptions): MacHost {
  const request = createBridgeClient({
    port: options.port,
    timeoutMs: options.timeoutMs ?? MAC_REQUEST_TIMEOUT_MS,
    ...(options.newId ? { newId: options.newId } : {}),
    answer: (raw) => {
      const parsed = macBridgeFromHostSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    results: macHostResultSchemas,
    request: (id, sent) => ({ kind: 'mac:request', id, request: sent }) as MacBridgeToHost,
    cancel: (id) => ({ kind: 'mac:cancel', id }) as const,
    failure: (code, message) => new MacHostError(code as MacHostFailure, message),
    timeoutMessage: 'Mac control took too long to answer.',
    invalidMessage: 'Mac control sent an answer Spark cannot read.',
  });
  return {
    request: (sent, signal) => request(sent, signal) as never,
  };
}
