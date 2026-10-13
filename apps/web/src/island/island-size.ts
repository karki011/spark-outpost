import { ISLAND_BLOB, islandHoverReach, islandTuck } from '@spark-outpost/contracts';
import type { IslandSize } from '../desktop/desktop-bridge.ts';
import { useCompanionStatus } from '../desktop/use-companion-status.ts';

export const ISLAND_SIZES: readonly { id: IslandSize; label: string }[] = [
  { id: 'full', label: 'Full' },
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
  { id: 'xlarge', label: 'Extra large' },
];

export const DEFAULT_ISLAND_SIZE: IslandSize = 'full';
const UNSET_ISLAND_SIZE: IslandSize = 'large';

const SMALL_BLOB = 38;

export interface RestMetrics {
  blob: number;
  tuck: number;
  reach: number;
}

function measure(blob: number): RestMetrics {
  return { blob, tuck: islandTuck(blob), reach: islandHoverReach(blob) };
}

const METRICS = new Map(ISLAND_SIZES.map((option) => [option.id, measure(ISLAND_BLOB[option.id])]));

export function restMetrics(size: IslandSize): RestMetrics {
  return METRICS.get(size) ?? measure(SMALL_BLOB);
}

export function useAutoExpandSetting(): boolean {
  return useCompanionStatus()?.autoExpand === true;
}

export function useIslandSize(): IslandSize {
  return useCompanionStatus()?.islandSize ?? UNSET_ISLAND_SIZE;
}
