import { LOOP_STREAK } from '../advisor/policy.ts';
import type { ProviderOutput } from '../providers/provider.ts';

export interface LoopGuardSettings {
  streak: number;
}

export const DEFAULT_LOOP_GUARD: LoopGuardSettings = { streak: LOOP_STREAK };

export interface LoopGuard {
  observe(output: ProviderOutput): void;
  tripped(): string | null;
}

const EDIT_KINDS = new Set(['edit', 'delete', 'move']);
const LOOKUP_KINDS = new Set(['read', 'search', 'fetch']);

function streakFor(output: { target?: string; toolKind?: string }, settings: LoopGuardSettings) {
  return !output.target && LOOKUP_KINDS.has(output.toolKind ?? '')
    ? settings.streak * 2
    : settings.streak;
}

function shortTitle(title: string): string {
  const flat = title.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

export function loopSummary(name: string, title: string, count: number): string {
  return `${name} repeated \`${shortTitle(title)}\` ${count} times in a row`;
}

export function createLoopGuard(
  name: string,
  settings: LoopGuardSettings | null,
  onTrip: () => void,
): LoopGuard {
  let last: string | null = null;
  let count = 0;
  let summary: string | null = null;
  return {
    observe(output) {
      if (!settings || summary || output.kind !== 'step_started' || !output.tool) return;
      if (EDIT_KINDS.has(output.toolKind ?? '')) {
        last = null;
        count = 0;
        return;
      }
      const key = output.target ? `${output.name}\u0000${output.target}` : output.name;
      count = key === last ? count + 1 : 1;
      last = key;
      if (count < streakFor(output, settings)) return;
      summary = loopSummary(name, output.name, count);
      onTrip();
    },
    tripped: () => summary,
  };
}
