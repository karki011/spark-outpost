import type { ModelAvailability, ProviderAccount } from '@spark-outpost/contracts';

export interface RejectedModel {
  id: string;
  label: string;
  at: string;
}

export interface StoredAccess {
  method: 'cli' | 'api_key';
  account: ProviderAccount | null;
  listed: readonly string[];
  unlisted: readonly string[];
  rejected: readonly RejectedModel[];
  reportedAt: Date | null;
}

export interface ReportedAccess {
  account: ProviderAccount | null;
  listed: readonly string[];
  unlisted: readonly string[];
}

export function availabilityOf(access: StoredAccess | null, model: string): ModelAvailability {
  if (!access) return 'unknown';
  if (access.rejected.some((entry) => entry.id === model)) return 'unusable';
  if (access.reportedAt === null || access.unlisted.includes(model)) return 'unknown';
  return access.listed.includes(model) ? 'usable' : 'unknown';
}

export function withAvailability<T extends { id: string }>(
  models: readonly T[],
  access: StoredAccess | null,
): (T & { availability: ModelAvailability })[] {
  return models.map((model) => ({ ...model, availability: availabilityOf(access, model.id) }));
}

export function selectable<T extends { id: string }>(
  models: readonly T[],
  access: StoredAccess | null,
): T[] {
  const rated = withAvailability(models, access);
  const allowed = rated.filter((model) => model.availability !== 'unusable');
  const confirmed = allowed.filter((model) => model.availability === 'usable');
  const kept = new Set((confirmed.length > 0 ? confirmed : allowed).map((model) => model.id));
  return models.filter((model) => kept.has(model.id));
}

export function selectableDefault(
  models: readonly { id: string }[],
  kept: readonly { id: string }[],
  adapterDefault: string | null,
): string | null {
  const has = (list: readonly { id: string }[]) =>
    list.some((model) => model.id === adapterDefault);
  return has(models) && !has(kept) ? (kept[0]?.id ?? adapterDefault) : adapterDefault;
}

function sameSignIn(stored: StoredAccess, method: string, account: ProviderAccount | null) {
  if (stored.method !== method) return false;
  if (!stored.account || !account) return true;
  return stored.account.kind === account.kind && stored.account.plan === account.plan;
}

export function emptyAccess(method: 'cli' | 'api_key'): StoredAccess {
  return { method, account: null, listed: [], unlisted: [], rejected: [], reportedAt: null };
}

export function mergeReport(
  stored: StoredAccess | null,
  method: 'cli' | 'api_key',
  report: ReportedAccess,
  reports: boolean,
  now: Date,
): StoredAccess {
  const kept = withAccount(stored, method, report.account);
  return {
    ...kept,
    listed: reports ? report.listed : [],
    unlisted: reports ? report.unlisted : [],
    reportedAt: reports ? now : null,
  };
}

export function withAccount(
  stored: StoredAccess | null,
  method: 'cli' | 'api_key',
  account: ProviderAccount | null,
): StoredAccess {
  const kept = stored && sameSignIn(stored, method, account) ? stored : emptyAccess(method);
  return { ...kept, method, account: account ?? kept.account };
}
