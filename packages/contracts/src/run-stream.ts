import { z } from 'zod';
import { parseRunEvent, type RunEvent } from './run-events.ts';

export const RUN_STREAM_PATH = '/api/run-events';
export const RUN_STREAM_MAX_RUNS = 64;

export type RunCursors = ReadonlyMap<string, number>;

export function runCursorsParam(cursors: RunCursors): string {
  return [...cursors].map(([runId, seq]) => `${runId}:${seq}`).join(',');
}

const cursorEntrySchema = z.tuple([
  z.uuid(),
  z
    .string()
    .regex(/^\d{1,9}$/)
    .transform(Number),
]);

export function parseRunCursors(raw: unknown): Map<string, number> | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const entries = raw.split(',');
  if (entries.length > RUN_STREAM_MAX_RUNS) return null;
  const cursors = new Map<string, number>();
  for (const entry of entries) {
    const parsed = cursorEntrySchema.safeParse(entry.split(':'));
    if (!parsed.success || cursors.has(parsed.data[0])) return null;
    cursors.set(parsed.data[0], parsed.data[1]);
  }
  return cursors;
}

export type RunStreamEnd = 'done' | 'missing';

export type RunStreamFrame =
  { runId: string; seq: number; event: RunEvent } | { runId: string; end: RunStreamEnd };

const frameSchema = z.union([
  z.object({ runId: z.string(), seq: z.number().int().positive(), event: z.unknown() }),
  z.object({ runId: z.string(), end: z.enum(['done', 'missing']) }),
]);

export function parseRunStreamFrame(raw: string): RunStreamFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = frameSchema.safeParse(value);
  if (!parsed.success) return null;
  if ('end' in parsed.data) return parsed.data;
  const event = parseRunEvent(parsed.data.event);
  return event ? { runId: parsed.data.runId, seq: parsed.data.seq, event } : null;
}
