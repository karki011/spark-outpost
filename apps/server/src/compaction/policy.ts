import { reaskPercent, type CompactionSettings } from '@spark-outpost/contracts';
import { COMPACT_AGENT_WORKED, COMPACT_SELF_DROP } from '../advisor/policy.ts';
import type { ContextReading } from '../persistence/provider-sessions.ts';

export type NaturalBreak = 'plan-done' | 'pull-request';

export type CompactTrigger = { kind: 'threshold' } | { kind: 'break'; why: NaturalBreak };

export type CompactDecision =
  { step: 'none' } | { step: 'ask' | 'compact'; trigger: CompactTrigger };

export interface CompactFacts {
  reading: ContextReading | null;
  snoozed: boolean;
  cardPending: boolean;
  thresholds: CompactionSettings;
  naturalBreak: NaturalBreak | null;
}

const NOTHING: CompactDecision = { step: 'none' };

export function usedPercent(reading: ContextReading): number {
  if (reading.size <= 0) return 0;
  return Math.min(100, Math.round((reading.used / reading.size) * 100));
}

function breakTrigger(facts: CompactFacts, used: number): CompactTrigger | null {
  const { compactAtBreak, warnPercent } = facts.thresholds;
  if (!compactAtBreak || facts.snoozed || !facts.naturalBreak || used < warnPercent) return null;
  return { kind: 'break', why: facts.naturalBreak };
}

export function compactStep(facts: CompactFacts): CompactDecision {
  if (!facts.reading || facts.cardPending) return NOTHING;
  const { compactPercent, autoCompact } = facts.thresholds;
  const used = usedPercent(facts.reading);
  const threshold = facts.snoozed ? reaskPercent(compactPercent) : compactPercent;
  const trigger: CompactTrigger | null =
    used >= threshold ? { kind: 'threshold' } : breakTrigger(facts, used);
  if (!trigger) return NOTHING;
  return { step: autoCompact ? 'compact' : 'ask', trigger };
}

export function selfCompacted(
  previous: ContextReading | null,
  current: ContextReading | null,
): boolean {
  if (!previous || !current || previous.used <= 0) return false;
  return (previous.used - current.used) / previous.used > COMPACT_SELF_DROP;
}

export function agentCompactWorked(
  before: ContextReading,
  after: ContextReading | null,
): after is ContextReading {
  return after !== null && after.used < before.used * COMPACT_AGENT_WORKED;
}

export function readingOf(used: number | null, size: number | null): ContextReading | null {
  if (used === null || size === null || size <= 0) return null;
  return { used, size };
}
