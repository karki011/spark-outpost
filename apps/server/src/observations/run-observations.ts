import type { Db } from '../persistence/db.ts';
import {
  recordObservation,
  turnObservations,
  type Observation,
} from '../persistence/observations.ts';
import type { NewRailFlag } from '../persistence/rail-flags.ts';
import { raiseRailFlag } from './raise-flag.ts';
import type { ProtocolObserver } from '../providers/provider.ts';

export interface EgressAsk {
  approvalId: string;
  subject: string;
  reason: string | null;
  observed: readonly string[];
  sendsTo?: string | undefined;
}

export interface SentOutNote {
  toolCallId: string | null;
  subject: string;
  target: string;
  observed: readonly string[];
  approvalId?: string | undefined;
}

export interface RunObservations {
  record(observation: Observation): void;
  labels(): Promise<string[]>;
  egressAsked(ask: EgressAsk): void;
  sentOut(note: SentOutNote): void;
  crossed(flag: NewRailFlag): Promise<void>;
  later(work: () => Promise<void>): void;
  settled(): Promise<void>;
}

export interface RunObservationsOptions {
  db: Db;
  runId: string;
  audit?: ProtocolObserver | undefined;
}

const MAX_LABEL = 200;
const CHAT_CONTEXT_TOOLS = [
  ...['spark_task', 'spark_chat', 'spark_chat_history'],
  ...['spark_run', 'spark_audit'],
];
const RETIRED_LABELS = new Set(CHAT_CONTEXT_TOOLS.map((tool) => `private work data (${tool})`));

const keyOf = (observation: Observation) => `${observation.source}\u0000${observation.label}`;

export function createRunObservations(options: RunObservationsOptions): RunObservations {
  const seen = new Map<string, Observation>();
  const flagged = new Set<string>();
  let writes: Promise<void> = Promise.resolve();

  const audit = (method: string, params: Record<string, unknown>) => {
    try {
      options.audit?.message('harness', { method, params });
    } catch (error) {
      console.error('Could not audit an observation', error);
    }
  };

  const crossed = (flag: NewRailFlag) =>
    raiseRailFlag(options.db, options.runId, options.audit, flag);

  const flag = (note: SentOutNote) =>
    crossed({
      toolCallId: note.toolCallId,
      rail: 'sent_out',
      paths: [note.target],
      inside: false,
      originals: [],
      read: note.observed,
    });

  const later = (work: () => Promise<void>) => {
    writes = writes
      .then(work)
      .catch((error: unknown) => console.error('Could not record an observation', error));
  };

  const save = (observation: Observation) => {
    later(() => recordObservation(options.db, options.runId, observation));
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
    async labels() {
      const stored = await turnObservations(options.db, options.runId).catch((error: unknown) => {
        console.error('Could not read observations', error);
        return [];
      });
      const counted = [...stored, ...seen.values()].filter(
        (observation) => !RETIRED_LABELS.has(observation.label),
      );
      return [...new Set(counted.map((observation) => observation.label))];
    },
    egressAsked(ask) {
      audit('spark/egress', {
        approvalId: ask.approvalId,
        subject: ask.subject,
        reason: ask.reason,
        observed: ask.observed,
        ...(ask.sendsTo ? { sendsTo: ask.sendsTo } : {}),
      });
    },
    sentOut(note) {
      audit('spark/egress', {
        outcome: 'ran',
        subject: note.subject,
        sendsTo: note.target,
        observed: note.observed,
        ...(note.approvalId ? { approvalId: note.approvalId } : {}),
      });
      if (flagged.has(note.target)) return;
      flagged.add(note.target);
      later(() => flag(note));
    },
    crossed,
    later,
    async settled() {
      let awaited: Promise<void> | null = null;
      while (awaited !== writes) {
        awaited = writes;
        await awaited;
      }
    },
  };
}
