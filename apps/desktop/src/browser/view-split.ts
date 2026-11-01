import { SPLIT_RATIO_DEFAULT, type BrowserViewSplit } from '@spark-outpost/contracts';

export interface SplitMark {
  side: 'left' | 'right';
  ratio: number;
}

export function splitOf(
  leftTabId: string,
  rightTabId: string,
  ratio: number = SPLIT_RATIO_DEFAULT,
): BrowserViewSplit | null {
  return leftTabId === rightTabId ? null : { leftTabId, rightTabId, ratio };
}

export function splitForLink(
  current: BrowserViewSplit | null,
  openerId: string,
  linkId: string,
): BrowserViewSplit | null {
  return splitOf(openerId, linkId, current?.ratio ?? SPLIT_RATIO_DEFAULT);
}

export function splitAlive(split: BrowserViewSplit, liveIds: readonly string[]): boolean {
  return liveIds.includes(split.leftTabId) && liveIds.includes(split.rightTabId);
}

export function splitSurvivor(split: BrowserViewSplit, liveIds: readonly string[]): string | null {
  return [split.leftTabId, split.rightTabId].find((tabId) => liveIds.includes(tabId)) ?? null;
}

export function splitMark(split: BrowserViewSplit | null, tabId: string): SplitMark | undefined {
  if (split?.leftTabId === tabId) return { side: 'left', ratio: split.ratio };
  if (split?.rightTabId === tabId) return { side: 'right', ratio: split.ratio };
  return undefined;
}

export function splitFromMarks(
  tabs: readonly { id: string; split?: SplitMark | undefined }[],
): BrowserViewSplit | null {
  const lefts = tabs.filter((tab) => tab.split?.side === 'left');
  const rights = tabs.filter((tab) => tab.split?.side === 'right');
  if (lefts.length !== 1 || rights.length !== 1) return null;
  return splitOf(lefts[0]!.id, rights[0]!.id, lefts[0]!.split!.ratio);
}
