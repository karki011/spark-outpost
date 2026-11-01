import { z } from 'zod';

export const BROWSER_ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const BROWSER_ZOOM_MIN = BROWSER_ZOOM_STEPS[0]!;
export const BROWSER_ZOOM_MAX = BROWSER_ZOOM_STEPS.at(-1)!;

export const browserZoomSchema = z.number().min(BROWSER_ZOOM_MIN).max(BROWSER_ZOOM_MAX);

export const browserZoomStepSchema = z.enum(['in', 'out', 'reset']);
export type BrowserZoomStep = z.infer<typeof browserZoomStepSchema>;

export const browserPipResultSchema = z.object({
  pip: z.enum(['entered', 'left', 'no_video', 'refused']),
});
export type BrowserPipResult = z.infer<typeof browserPipResultSchema>;

export function nextBrowserZoom(current: number, step: BrowserZoomStep): number {
  if (step === 'reset') return 1;
  if (step === 'in') return BROWSER_ZOOM_STEPS.find((zoom) => zoom > current) ?? BROWSER_ZOOM_MAX;
  return BROWSER_ZOOM_STEPS.findLast((zoom) => zoom < current) ?? BROWSER_ZOOM_MIN;
}

export function browserZoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

export function movedTabs<T extends { id: string }>(
  tabs: readonly T[],
  tabId: string,
  before: string | null,
): T[] {
  const moving = tabs.find((tab) => tab.id === tabId);
  if (!moving || before === tabId) return [...tabs];
  const rest = tabs.filter((tab) => tab !== moving);
  const at = before === null ? -1 : rest.findIndex((tab) => tab.id === before);
  if (before !== null && at < 0) return [...tabs];
  return at < 0 ? [...rest, moving] : [...rest.slice(0, at), moving, ...rest.slice(at)];
}
