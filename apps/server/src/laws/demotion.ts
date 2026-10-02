import type { ModelTier } from '@spark-outpost/contracts';
import {
  LAW_DEMOTE_FLOOR,
  LAW_DEMOTE_MARGIN,
  LAW_DEMOTE_MIN_RUNS,
  LAW_DEMOTE_WINDOW,
} from '../advisor/policy.ts';

export interface BuilderOutcome {
  provider: string;
  model: string;
  kind: string;
  passed: boolean;
}

export interface ModelRecord {
  provider: string;
  model: string;
  label: string;
  tier: ModelTier | null;
  kind: string;
  passed: number;
  runs: number;
}

export interface Demotion extends ModelRecord {
  rate: number;
  peers: { passed: number; runs: number; rate: number } | null;
  bar: number;
}

export type ModelInfo = (
  provider: string,
  model: string,
) => { label: string; tier: ModelTier | null };

const keyOf = (outcome: Pick<BuilderOutcome, 'provider' | 'model' | 'kind'>) =>
  `${outcome.provider}\u0000${outcome.model}\u0000${outcome.kind}`;

export function recentRecords(outcomes: readonly BuilderOutcome[], info: ModelInfo): ModelRecord[] {
  const windows = new Map<string, BuilderOutcome[]>();
  for (const outcome of outcomes) {
    const window = windows.get(keyOf(outcome)) ?? [];
    if (window.length < LAW_DEMOTE_WINDOW) window.push(outcome);
    windows.set(keyOf(outcome), window);
  }
  return [...windows.values()].map((window) => {
    const first = window[0]!;
    return {
      provider: first.provider,
      model: first.model,
      ...info(first.provider, first.model),
      kind: first.kind,
      passed: window.filter((outcome) => outcome.passed).length,
      runs: window.length,
    };
  });
}

function peersOf(record: ModelRecord, records: readonly ModelRecord[]) {
  const peers = records.filter(
    (other) =>
      other.kind === record.kind &&
      other.tier === record.tier &&
      other.runs >= LAW_DEMOTE_MIN_RUNS &&
      !(other.provider === record.provider && other.model === record.model),
  );
  if (peers.length === 0) return null;
  const passed = peers.reduce((sum, peer) => sum + peer.passed, 0);
  const runs = peers.reduce((sum, peer) => sum + peer.runs, 0);
  return { passed, runs, rate: passed / runs };
}

export function demotions(records: readonly ModelRecord[]): Demotion[] {
  return records.flatMap((record) => {
    if (record.runs < LAW_DEMOTE_MIN_RUNS || record.tier === null) return [];
    const rate = record.passed / record.runs;
    const peers = peersOf(record, records);
    const bar = peers ? peers.rate - LAW_DEMOTE_MARGIN : LAW_DEMOTE_FLOOR;
    return rate < bar ? [{ ...record, rate, peers, bar }] : [];
  });
}

const KIND_WORDS: Record<string, string> = {
  bug_fix: 'bug fixes',
  feature: 'features',
  refactor: 'refactors',
  docs: 'docs changes',
  tests: 'test changes',
  config: 'config changes',
  review: 'reviews',
  other: 'tasks',
};

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function demotionText(demotion: Demotion): string {
  const kind = KIND_WORDS[demotion.kind] ?? `${demotion.kind.replace('_', ' ')} tasks`;
  const against = demotion.peers
    ? `its ${demotion.tier} tier peers ${percent(demotion.peers.rate)}`
    : `the ${percent(LAW_DEMOTE_FLOOR)} floor`;
  return `${demotion.label} has passed ${percent(demotion.rate)} of recent ${kind} here (${demotion.passed}/${demotion.runs}; ${against})`;
}

export function demotedFor(
  list: readonly Demotion[],
  provider: string,
  model: string | null,
): Demotion | null {
  return list.find((entry) => entry.provider === provider && entry.model === model) ?? null;
}
