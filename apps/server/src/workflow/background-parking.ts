import type { ProviderOutput } from '../providers/provider.ts';
import type { ParkedTurns } from './parked-turns.ts';

export interface BackgroundParking {
  observe(output: ProviderOutput): boolean;
  release(): void;
}

export function backgroundParking(
  parked: Pick<ParkedTurns, 'park'> | undefined,
  runId: string,
  onQuit: () => void,
): BackgroundParking {
  let unpark: (() => void) | null = null;
  const release = () => {
    unpark?.();
    unpark = null;
  };
  return {
    observe(output) {
      if (output.kind !== 'background_work') return false;
      if (output.agents + output.tasks === 0) release();
      else unpark ??= parked?.park(runId, onQuit) ?? null;
      return true;
    },
    release,
  };
}
