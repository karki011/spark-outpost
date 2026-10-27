export const ISLAND_SIZES = ['full', 'small', 'medium', 'large', 'xlarge'] as const;

export type IslandSize = (typeof ISLAND_SIZES)[number];

export const ISLAND_BLOB: Readonly<Record<IslandSize, number>> = {
  full: 58,
  small: 38,
  medium: 48,
  large: 58,
  xlarge: 116,
};

const SMALL_BLOB = 38;
const SMALL_TUCK = 20;

export function islandTuck(blob: number): number {
  return Math.round((SMALL_TUCK * blob) / SMALL_BLOB);
}

export const ISLAND_HEIGHT_RANGE = { min: -32, max: 32, default: 0 } as const;

export function isIslandHeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= ISLAND_HEIGHT_RANGE.min &&
    value <= ISLAND_HEIGHT_RANGE.max
  );
}
