import type { Socket } from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';

export const HOST_FRAME_LIMIT = 16_000_000;

const sessionId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const size = z.number().int().min(1).max(2_000);
const secret = z.string().min(32).max(100);
const text = z.string().max(4_000_000);

export const hostRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create'),
    session: sessionId,
    cols: size,
    rows: size,
    cwd: z.string().min(1).max(4096),
    command: z.string().min(1).max(4096),
    args: z.array(text).max(10_000),
    env: z.record(z.string(), z.string()),
  }),
  z.object({ kind: z.literal('attach'), session: sessionId }),
  z.object({ kind: z.literal('write'), session: sessionId, data: text }),
  z.object({ kind: z.literal('resize'), session: sessionId, cols: size, rows: size }),
  z.object({ kind: z.literal('screen'), session: sessionId }),
  z.object({ kind: z.literal('list') }),
  z.object({ kind: z.literal('kill'), session: sessionId }),
  z.object({ kind: z.literal('remove'), session: sessionId }),
  z.object({ kind: z.literal('shutdown') }),
]);

export type HostRequest = z.infer<typeof hostRequestSchema>;
export type CreateRequest = Extract<HostRequest, { kind: 'create' }>;

const exitSchema = z.object({
  exitCode: z.number().int(),
  signal: z.number().int().nullable(),
});

export type HostExit = z.infer<typeof exitSchema>;

export const clientFrameSchema = z.union([
  z.object({ kind: z.literal('hello'), nonce: secret }),
  z.object({ kind: z.literal('proof'), proof: secret }),
  z.object({ id: z.number().int().min(0), request: hostRequestSchema }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

export const hostFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('welcome'), nonce: secret, proof: secret }),
  z.object({
    kind: z.literal('reply'),
    id: z.number().int().min(0),
    result: z.unknown().optional(),
    error: z.string().max(2_000).optional(),
  }),
  z.object({ kind: z.literal('output'), session: sessionId, data: text }),
  z.object({ kind: z.literal('exit'), session: sessionId, exit: exitSchema }),
]);

export type HostFrame = z.infer<typeof hostFrameSchema>;

export const attachedSchema = z.object({
  pid: z.number().int(),
  replay: z.string(),
  exit: exitSchema.nullable(),
});

export type Attached = z.infer<typeof attachedSchema>;

export const listedSchema = z.array(
  z.object({ session: sessionId, pid: z.number().int(), exited: z.boolean() }),
);

export type Listed = z.infer<typeof listedSchema>;

export const createdSchema = z.object({ pid: z.number().int() });

export function frameReader(
  onFrame: (raw: unknown) => boolean,
  onBad: () => void,
): (chunk: Buffer) => void {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let broken = false;
  return (chunk) => {
    if (broken) return;
    buffer += decoder.write(chunk);
    let boundary: number;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        broken = true;
        onBad();
        return;
      }
      if (!onFrame(raw)) {
        broken = true;
        onBad();
        return;
      }
    }
    if (buffer.length > HOST_FRAME_LIMIT) {
      broken = true;
      onBad();
    }
  };
}

export function encodeFrame(frame: ClientFrame | HostFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

export function sendFrame(socket: Socket, frame: ClientFrame | HostFrame): void {
  if (!socket.destroyed) socket.write(encodeFrame(frame));
}
