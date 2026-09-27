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
      count = output.name === last ? count + 1 : 1;
      last = output.name;
      if (count < settings.streak) return;
      summary = loopSummary(name, output.name, count);
      onTrip();
    },
    tripped: () => summary,
  };
}
