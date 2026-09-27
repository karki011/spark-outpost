import type { CapabilityOption, ProviderId } from '@spark-outpost/contracts';
import { catalogEntry } from './catalog.ts';

const AGENT_DEFAULT = 'default';

export const INITIAL_PROVIDER_EFFORT = 'medium';

export function reportedEfforts(
  provider: ProviderId,
  captured: readonly CapabilityOption[] | null,
): CapabilityOption[] {
  const reported = (captured ?? []).filter((effort) => effort.id !== AGENT_DEFAULT);
  if (reported.length > 0) return reported;
  return catalogEntry(provider).efforts.map(({ id, label, description }) => ({
    id,
    label,
    description,
  }));
}

export function firstReportedEffort(
  sources: readonly (string | null | undefined)[],
  reported: readonly string[],
): string | null {
  const known = (effort: string | null | undefined): effort is string =>
    typeof effort === 'string' &&
    effort !== '' &&
    (reported.length === 0 || reported.includes(effort));
  return sources.find(known) ?? null;
}
