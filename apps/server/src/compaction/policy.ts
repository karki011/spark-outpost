import {
  reaskPercent,
  type CompactionThresholds,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { COMPACT_AGENT_WORKED, COMPACT_SELF_DROP } from '../advisor/policy.ts';
import type { ContextReading } from '../persistence/provider-sessions.ts';

export type CompactStep = 'none' | 'ask' | 'compact';

export interface CompactFacts {
  reading: ContextReading | null;
  level: InvolvementLevel;
  snoozed: boolean;
  cardPending: boolean;
  thresholds: CompactionThresholds;
}

export function usedPercent(reading: ContextReading): number {
  if (reading.size <= 0) return 0;
  return Math.min(100, Math.round((reading.used / reading.size) * 100));
}

export function compactStep(facts: CompactFacts): CompactStep {
  if (!facts.reading || facts.cardPending) return 'none';
  const { compactPercent, autoCompact } = facts.thresholds;
  const threshold = facts.snoozed ? reaskPercent(compactPercent) : compactPercent;
  if (usedPercent(facts.reading) < threshold) return 'none';
  return facts.level === 'balanced' || !autoCompact ? 'ask' : 'compact';
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
