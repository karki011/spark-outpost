import type { Queryable } from '../persistence/db.ts';
import {
  recordObservation,
  turnObservations,
  type Observation,
  type ObservationSource,
} from '../persistence/observations.ts';

export const CARRIED_LABELS_MAX = 50;
const LABEL_MAX = 300;

const SOURCES: ReadonlySet<string> = new Set<ObservationSource>([
  'secret_file',
  'secret_output',
  'private_data',
  'web_page',
]);

export type OutpostRead = 'answer' | 'notes';

export interface ReadLabels {
  labelsOf(db: Queryable, runId: string): Promise<Observation[]>;
  recordCarried(db: Queryable, runId: string, observed: readonly Observation[]): Promise<void>;
  recordOutpostRead(db: Queryable, runId: string, read: OutpostRead): Promise<void>;
}

function carriable(observed: readonly Observation[]): Observation[] {
  const seen = new Set<string>();
  const kept: Observation[] = [];
  for (const { source, label } of observed) {
    const key = `${source}\n${label}`;
    if (!SOURCES.has(source) || typeof label !== 'string' || label.length === 0) continue;
    if (label.length > LABEL_MAX || seen.has(key)) continue;
    seen.add(key);
    kept.push({ source, label });
  }
  return kept.slice(0, CARRIED_LABELS_MAX);
}

export const labelsOf: ReadLabels['labelsOf'] = async (db, runId) =>
  carriable(await turnObservations(db, runId));

export const recordCarried: ReadLabels['recordCarried'] = async (db, runId, observed) => {
  for (const observation of carriable(observed)) {
    await recordObservation(db, runId, observation);
  }
};

function outpostReadLabel(read: OutpostRead): Observation {
  return { source: 'private_data', label: `private work data (outpost ${read})` };
}

export const recordOutpostRead: ReadLabels['recordOutpostRead'] = (db, runId, read) =>
  recordObservation(db, runId, outpostReadLabel(read));

export const readLabels: ReadLabels = { labelsOf, recordCarried, recordOutpostRead };
