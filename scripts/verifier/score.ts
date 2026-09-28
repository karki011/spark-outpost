import type { Variant } from './case.ts';

export interface Scored {
  variant: Variant;
  jev: {
    verdict: string | null;
    confidence: number | null;
    accepted: string | null;
    unmet: { noul: number | null }[];
    costUsd: number;
  } | null;
  critic: { verdict: string; costUsd: number } | null;
}

export interface Confusion {
  flagged: number;
  truePositives: number;
  positives: number;
  precision: number | null;
  recall: number | null;
}

function confusion<T extends Scored>(
  results: readonly T[],
  flags: (result: T) => boolean,
): Confusion {
  const positives = results.filter((result) => result.variant === 'wrong').length;
  const flagged = results.filter(flags);
  const truePositives = flagged.filter((result) => result.variant === 'wrong').length;
  return {
    flagged: flagged.length,
    truePositives,
    positives,
    precision: flagged.length > 0 ? truePositives / flagged.length : null,
    recall: positives > 0 ? truePositives / positives : null,
  };
}

const maxUnmet = (result: Scored) =>
  Math.max(0, ...(result.jev?.unmet.map((entry) => entry.noul ?? 0) ?? []));

const SIGNALS: Record<string, (result: Scored) => boolean> = {
  'Jev unsupported, accepted (confidence ≥ 0.8)': (result) =>
    result.jev?.accepted === 'unsupported',
  'Jev unsupported, top choice at any confidence': (result) =>
    result.jev?.verdict === 'unsupported',
  'Jev worst requirement Noul ≥ 0.8': (result) => maxUnmet(result) >= 0.8,
  'Jev worst requirement Noul ≥ 0.5': (result) => maxUnmet(result) >= 0.5,
  'Critic (Sonnet) "concerns"': (result) => result.critic?.verdict === 'concerns',
};

function percent(value: number | null): string {
  return value === null ? '–' : `${Math.round(value * 100)}%`;
}

export function summarise(results: readonly Scored[]): string {
  const lines = [
    '| Signal | Flagged | True positives | Precision | Recall |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const [name, flags] of Object.entries(SIGNALS)) {
    if (name.startsWith('Critic') && !results.some((result) => result.critic)) continue;
    const scored = confusion(results, flags);
    lines.push(
      `| ${name} | ${scored.flagged} | ${scored.truePositives}/${scored.positives} | ${percent(scored.precision)} | ${percent(scored.recall)} |`,
    );
  }
  const count = (verdict: string) =>
    results.filter((result) => result.jev?.verdict === verdict).length;
  const accepted = results.filter((result) => result.jev?.accepted).length;
  const jevCost = results.reduce((sum, result) => sum + (result.jev?.costUsd ?? 0), 0);
  const criticCost = results.reduce((sum, result) => sum + (result.critic?.costUsd ?? 0), 0);
  lines.push(
    '',
    `Top choice: supported ${count('supported')}, unsupported ${count('unsupported')}, declined ${count('declined')}, no valid answer ${results.filter((result) => !result.jev?.verdict).length}. Accepted at 0.8: ${accepted} of ${results.length}.`,
    `Cost: Jev $${jevCost.toFixed(4)}, Critic $${criticCost.toFixed(2)}.`,
  );
  return lines.join('\n');
}
