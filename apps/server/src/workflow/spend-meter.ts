import type { ProviderOutput } from '../providers/provider.ts';
import type { LiveCost } from '../usage/live-cost.ts';

export interface SpendMeter {
  produced(output: ProviderOutput): void;
  recording(output: ProviderOutput): void;
  read(output: ProviderOutput): void;
}

export function createSpendMeter(
  live: LiveCost,
  report: ((usd: number, final: boolean) => void) | undefined,
): SpendMeter {
  let reported = 0;
  let recorded = 0;
  const tell = (final: boolean) =>
    report?.(live.unreported() + Math.max(0, reported - recorded), final);
  const reportedCost = (output: ProviderOutput) =>
    output.kind === 'usage' ? output.costUsd : null;
  return {
    produced(output) {
      const cost = reportedCost(output);
      if (cost === null || cost <= reported) return;
      reported = cost;
      tell(false);
    },
    recording(output) {
      const cost = reportedCost(output);
      if (cost !== null) recorded = Math.max(recorded, cost);
    },
    read(output) {
      if (live.observe(output)) tell(output.kind === 'tokens');
    },
  };
}
