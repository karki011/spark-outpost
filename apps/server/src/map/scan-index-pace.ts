import { availableParallelism } from 'node:os';
import type { IndexOptions } from '../codescan/indexer.ts';
import { WRITE_BATCH } from '../codescan/store.ts';
import type { Queryable } from '../persistence/db.ts';
import { createGate, systemClock, type Clock } from './pace.ts';
import { CPU_BUDGET, MAP_POLL_MS } from './policy.ts';
import { agentsBusy } from './store.ts';

export const LOW_CORE_COUNT = 4;
export const UNPACED_REFRESH_FILES = WRITE_BATCH;

type IndexPace = NonNullable<IndexOptions['pace']>;

export interface ScanIndexPaceOptions {
  db: Queryable;
  cores?: number;
  busy?: () => Promise<boolean>;
  pollMs?: number;
  busyCheckMs?: number;
  clock?: Clock;
}

export function scanIndexPace(options: ScanIndexPaceOptions): (() => IndexPace) | undefined {
  if ((options.cores ?? availableParallelism()) > LOW_CORE_COUNT) return undefined;
  return () => {
    const gate = createGate({
      budget: CPU_BUDGET,
      ...(options.busyCheckMs === undefined ? {} : { busyCheckMs: options.busyCheckMs }),
      pollMs: options.pollMs ?? MAP_POLL_MS,
      busy: options.busy ?? (() => agentsBusy(options.db)),
      onPause: () => Promise.resolve(),
      signal: new AbortController().signal,
      clock: options.clock ?? systemClock,
    });
    return async (_done, total) => {
      if (total > UNPACED_REFRESH_FILES) await gate.step();
    };
  };
}
