import {
  signInName,
  type ModelRef,
  type ProviderAccess,
  type ProviderId,
} from '@spark-outpost/contracts';
import { availabilityOf, withAvailability, type StoredAccess } from './access.ts';
import { nearestUsable } from './nearest.ts';

export interface AccessViewInput {
  provider: ProviderId;
  providerName: string;
  access: StoredAccess | null;
  models: readonly ModelRef[];
  defaultModel: string | null;
  now?: Date;
}

export function replacementFor(
  provider: string,
  access: StoredAccess | null,
  models: readonly ModelRef[],
  rejected: ModelRef,
  now: Date = new Date(),
): ModelRef | null {
  const found = nearestUsable(rejected, withAvailability(models, access), provider, now);
  return found ? { id: found.id, label: found.label } : null;
}

export function accessView(input: AccessViewInput): ProviderAccess {
  const { provider, access, models, defaultModel } = input;
  const rated = withAvailability(models, access);
  const labelOf = (id: string) => models.find((model) => model.id === id)?.label ?? id;
  const broken = defaultModel !== null && availabilityOf(access, defaultModel) === 'unusable';
  const model = { id: defaultModel ?? '', label: labelOf(defaultModel ?? '') };
  return {
    account: access?.account ?? null,
    signIn: signInName(provider, input.providerName, access?.account ?? null),
    reported: access?.reportedAt != null,
    usable: rated.filter((entry) => entry.availability === 'usable').length,
    unknown: rated.filter((entry) => entry.availability === 'unknown').length,
    unusable: (access?.rejected ?? []).map(({ id, label }) => ({ id, label })),
    checkedAt: access?.reportedAt?.toISOString() ?? null,
    defaultIssue: broken
      ? { model, suggestion: replacementFor(provider, access, models, model, input.now) }
      : null,
  };
}
