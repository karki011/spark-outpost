import type { Db } from '../persistence/db.ts';
import {
  conversationObservations,
  recordObservation,
  type Observation,
  type ObservationSource,
} from '../persistence/observations.ts';
import type { ProtocolObserver } from '../providers/provider.ts';

export interface EgressAsk {
  approvalId: string;
  subject: string;
  reason: string | null;
  observed: readonly string[];
}

export interface RunObservations {
  record(observation: Observation): void;
  labels(except?: readonly ObservationSource[]): Promise<string[]>;
  egressAsked(ask: EgressAsk): void;
  settled(): Promise<void>;
}

export interface RunObservationsOptions {
  db: Db;
  runId: string;
  conversationId: string;
  audit?: ProtocolObserver | undefined;
}

const MAX_LABEL = 200;

const keyOf = (observation: Observation) => `${observation.source}\u0000${observation.label}`;

export function createRunObservations(options: RunObservationsOptions): RunObservations {
  const seen = new Map<string, Observation>();
  let writes: Promise<void> = Promise.resolve();

  const audit = (method: string, params: Record<string, unknown>) => {
    try {
      options.audit?.message('harness', { method, params });
    } catch (error) {
      console.error('Could not audit an observation', error);
    }
  };

  const save = (observation: Observation) => {
    writes = writes
      .then(() => recordObservation(options.db, options.runId, observation))
      .catch((error: unknown) => console.error('Could not record an observation', error));
  };

  return {
    record(observation) {
      const label = observation.label.slice(0, MAX_LABEL);
      const kept = { source: observation.source, label };
      const key = keyOf(kept);
      if (label === '' || seen.has(key)) return;
      seen.set(key, kept);
      audit('spark/observed', { source: kept.source, label: kept.label });
      save(kept);
    },
    async labels(except = []) {
      const stored = await conversationObservations(options.db, options.conversationId).catch(
        (error: unknown) => {
          console.error('Could not read observations', error);
          return [];
        },
      );
      const counted = [...stored, ...seen.values()].filter(
        (observation) => !except.includes(observation.source),
      );
      return [...new Set(counted.map((observation) => observation.label))];
    },
    egressAsked(ask) {
      audit('spark/egress', {
        approvalId: ask.approvalId,
        subject: ask.subject,
        reason: ask.reason,
        observed: ask.observed,
      });
    },
    settled: () => writes,
  };
}
