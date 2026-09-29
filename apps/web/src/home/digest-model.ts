import type { Digest, DigestState, DigestStats } from '@spark-outpost/contracts';
import { formatCost } from '../usage/format.ts';

export function digestMeta(digest: Digest, timeZone?: string): string {
  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(digest.finishedAt ?? digest.createdAt));
  return [
    `Generated ${time}`,
    digest.modelLabel,
    digest.costUsd === null ? null : formatCost(digest.costUsd, digest.costSource),
  ]
    .filter(Boolean)
    .join(' · ');
}

type DigestView = 'hidden' | 'loading' | 'writing' | 'ready' | 'failed' | 'quiet';

export function digestView(state: DigestState | undefined): DigestView {
  if (!state) return 'loading';
  if (!state.available) return 'hidden';
  const status = state.digest?.status;
  if (status === 'running') return 'writing';
  if (status === 'failed') return 'failed';
  if (status === 'ready') return 'ready';
  return 'quiet';
}

export function canRefresh(state: DigestState | undefined, now: number): boolean {
  if (!state?.available || state.digest?.status === 'running') return false;
  return !state.refreshableAt || Date.parse(state.refreshableAt) <= now;
}

export function refreshHint(state: DigestState | undefined, now: number): string | null {
  if (!state?.refreshableAt) return null;
  const minutes = Math.ceil((Date.parse(state.refreshableAt) - now) / 60_000);
  return minutes > 0 ? `You can refresh in ${minutes} min` : null;
}

export interface DigestChip {
  id: string;
  label: string;
  section: string;
}

export function digestChips(stats: DigestStats): DigestChip[] {
  const chips: DigestChip[] = [];
  if (stats.finished > 0) {
    chips.push({ id: 'finished', label: `${stats.finished} done`, section: 'home-recent' });
  }
  if (stats.waiting > 0) {
    chips.push({ id: 'waiting', label: `${stats.waiting} needs you`, section: 'home-needs' });
  }
  if (stats.failedOrStalled > 0) {
    chips.push({
      id: 'failed-or-stalled',
      label: `${stats.failedOrStalled} stalled`,
      section: 'home-needs',
    });
  }
  if (stats.costUsd !== null) {
    chips.push({ id: 'spend', label: formatCost(stats.costUsd), section: 'home-spend' });
  }
  return chips;
}
