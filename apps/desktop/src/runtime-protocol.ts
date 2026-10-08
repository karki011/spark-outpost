import { z } from 'zod';
import type { DatabaseOptions } from './postgres.ts';
import type { ServiceOptions } from './service.ts';

export interface RuntimeInfo {
  database: { url: string; port: number } | null;
  api: { port: number; token: string; version: string } | null;
}

export type RuntimeRequest =
  | { kind: 'info' }
  | { kind: 'database:start'; options: Omit<DatabaseOptions, 'log'> }
  | { kind: 'database:stop' }
  | { kind: 'service:start'; options: Omit<ServiceOptions, 'log' | 'connect'> }
  | { kind: 'service:stop'; name: string }
  | { kind: 'service:post'; name: string; message: unknown }
  | { kind: 'configure'; api: NonNullable<RuntimeInfo['api']> }
  | { kind: 'shutdown' };

export type RuntimeHandshake = { kind: 'hello'; nonce: string } | { kind: 'proof'; proof: string };

export type RuntimeEvent =
  | { kind: 'welcome'; nonce: string; proof: string }
  | { kind: 'reply'; id: string; result?: unknown; error?: string }
  | { kind: 'log'; name: string; line: string }
  | { kind: 'service:message'; name: string; message: unknown }
  | { kind: 'service:exit'; name: string; code: number | null };

export const RUNTIME_FRAME_LIMIT = 16_000_000;

const port = z.number().int().min(1).max(65_535);
const file = z.string().min(1).max(4096);
const name = z.string().min(1).max(100);
const api = z.object({
  port,
  token: z.string().min(1).max(4096),
  version: z.string().min(1).max(100),
});
const secret = z.string().min(32).max(100);
const runtimeEnvelopeSchema = z.object({
  id: z.uuid(),
  request: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('info') }),
    z.object({
      kind: z.literal('database:start'),
      options: z.object({ dataDir: file, passwordFile: file, port }),
    }),
    z.object({ kind: z.literal('database:stop') }),
    z.object({
      kind: z.literal('service:start'),
      options: z.object({
        name,
        bootstrap: file,
        entry: file,
        cwd: file,
        env: z.record(z.string(), z.string().optional()),
      }),
    }),
    z.object({ kind: z.literal('service:stop'), name }),
    z.object({ kind: z.literal('service:post'), name, message: z.unknown() }),
    z.object({ kind: z.literal('configure'), api }),
    z.object({ kind: z.literal('shutdown') }),
  ]),
});
export const runtimeFrameSchema = z.union([
  z.object({ kind: z.literal('hello'), nonce: secret }),
  z.object({ kind: z.literal('proof'), proof: secret }),
  runtimeEnvelopeSchema,
]);
export const runtimeEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('welcome'), nonce: secret, proof: secret }),
  z.object({
    kind: z.literal('reply'),
    id: z.uuid(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal('log'), name, line: z.string() }),
  z.object({ kind: z.literal('service:message'), name, message: z.unknown() }),
  z.object({ kind: z.literal('service:exit'), name, code: z.number().int().nullable() }),
]);
export const runtimeInfoSchema = z.object({
  database: z.object({ url: z.string().url(), port }).nullable(),
  api: api.nullable(),
});
