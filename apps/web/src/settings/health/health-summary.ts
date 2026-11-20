import { countLabel } from '../../ui/count-label.ts';
import type { HealthSource } from './use-health.ts';

export const HEALTH_EMPTY = 'Everything looks fine';

export type HealthSummaryKind = 'fine' | 'checking' | 'unchecked' | 'problems';

export function healthSummary(sources: readonly Pick<HealthSource, 'state' | 'items'>[]): {
  kind: HealthSummaryKind;
  text: string;
} {
  const count = sources.reduce((total, source) => total + source.items.length, 0);
  if (count > 0) return { kind: 'problems', text: `${countLabel(count, 'thing')} to look at` };
  if (sources.some((source) => source.state === 'checking')) {
    return { kind: 'checking', text: 'Checking…' };
  }
  if (sources.some((source) => source.state === 'failed')) {
    return { kind: 'unchecked', text: 'Some checks couldn’t run' };
  }
  return { kind: 'fine', text: HEALTH_EMPTY };
}
