export const DETAIL_DEFAULT_WIDTH = 500;
export const DETAIL_MIN_WIDTH = 360;
export const DETAIL_MAX_WIDTH = 820;

export function clampDetailWidth(width: number): number {
  return Math.round(Math.min(DETAIL_MAX_WIDTH, Math.max(DETAIL_MIN_WIDTH, width)));
}

export function parseDetailWidth(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const width = Number(raw);
  return Number.isFinite(width) ? clampDetailWidth(width) : null;
}
