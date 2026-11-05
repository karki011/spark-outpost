import { z } from 'zod';

export const SPLIT_RATIO_DEFAULT = 0.5;
export const SPLIT_RATIO_MIN = 0.15;
export const SPLIT_RATIO_MAX = 0.85;
export const SPLIT_SIDE_MIN_PX = 280;

const tabIdSchema = z.string().min(1).max(40);

export const browserViewSplitSchema = z.object({
  leftTabId: tabIdSchema,
  rightTabId: tabIdSchema,
  ratio: z.number().min(SPLIT_RATIO_MIN).max(SPLIT_RATIO_MAX),
});
export type BrowserViewSplit = z.infer<typeof browserViewSplitSchema>;

export function clampSplitRatio(ratio: number, width = 0): number {
  const room = width > 0 ? SPLIT_SIDE_MIN_PX / width : 0;
  const low = Math.max(SPLIT_RATIO_MIN, room);
  const high = Math.min(SPLIT_RATIO_MAX, 1 - room);
  if (low >= high) return SPLIT_RATIO_DEFAULT;
  const clamped = Math.min(high, Math.max(low, ratio));
  return Math.round(clamped * 1000) / 1000;
}

export function splitHolds(split: BrowserViewSplit | null, tabId: string | null): boolean {
  return split !== null && (split.leftTabId === tabId || split.rightTabId === tabId);
}
