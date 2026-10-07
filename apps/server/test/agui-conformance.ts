import { verifyEvents } from '@ag-ui/client';
import { from, lastValueFrom, toArray } from 'rxjs';
import { expect } from 'vitest';
import { parseRunEvent, type RunEvent } from '@spark-outpost/contracts';
import type { Db } from '../src/persistence/db.ts';

export async function storedEvents(db: Db, runId: string): Promise<RunEvent[]> {
  const { rows } = await db.query<{ payload: unknown }>(
    'SELECT payload FROM run_events WHERE run_id = $1 ORDER BY seq',
    [runId],
  );
  return rows.map(({ payload }) => {
    const event = parseRunEvent(payload);
    if (!event) throw new Error(`Stored event is not an AG-UI event: ${JSON.stringify(payload)}`);
    return event;
  });
}

export async function verifyStream(events: readonly RunEvent[]): Promise<void> {
  await lastValueFrom(from(events).pipe(verifyEvents(false), toArray()));
}

export async function expectConformantRun(db: Db, runId: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM runs WHERE id = $1 OR parent_run_id = $1 ORDER BY created_at',
    [runId],
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const { id } of rows) {
    const events = await storedEvents(db, id);
    if (id === runId) expect(events.length).toBeGreaterThan(0);
    await verifyStream(events).catch((error: unknown) => {
      throw new Error(`Run ${id === runId ? 'itself' : 'child'}: ${(error as Error).message}`);
    });
  }
}
